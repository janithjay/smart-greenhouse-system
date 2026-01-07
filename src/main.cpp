#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <LiquidCrystal_I2C.h>
#include <esp_task_wdt.h>
#include <Adafruit_AHTX0.h>
#include <ScioSense_ENS160.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include <LittleFS.h>
#include <HTTPUpdate.h>
#include <Update.h> // Required for Rollback
#include "secrets.h"

// ==========================================
// 1. CONFIGURATION & PINOUT
// ==========================================

Preferences preferences;

// --- CONFIGURABLE PARAMETERS (Loaded from NVS) ---
const char *FIRMWARE_VERSION = "1.0.0"; // Current Firmware Version
float TEMP_MIN_NIGHT = 20.0;              // Heater ON below this
float TEMP_MAX_DAY = 30.0;                // Fan ON above this
float HUM_MAX = 75.0;                     // Fan ON above this
int SOIL_DRY = 40;                        // Pump ON below this %
int SOIL_WET = 70;                        // Pump OFF above this %
int TANK_EMPTY_DIST = 25;                 // Distance when tank is empty (cm)
int TANK_FULL_DIST = 5;                   // Distance when tank is full (cm)

// --- SENSOR CALIBRATION (ESP32 is 12-bit: 0-4095) ---
int AIR_VAL = 4095;
int WATER_VAL = 1670;

// --- PIN DEFINITIONS ---
#define PIN_PUMP 26     // Water Pump Relay
#define PIN_FAN 27      // Exhaust Fan Relay
#define PIN_HEATER 14   // Heater / Halogen Lamp Relay
#define PIN_TRIG 5      // Ultrasonic Trig
#define PIN_ECHO 34     // Ultrasonic Echo
#define PIN_SOIL 32     // Soil Moisture Analog
#define PIN_RESET_BTN 4 // Boot Button (Hold 5s to reset WiFi)

// ==========================================
// 2. OBJECTS & VARIABLES
// ==========================================

LiquidCrystal_I2C lcd(0x27, 20, 4);
Adafruit_AHTX0 aht;
ScioSense_ENS160 ens160(ENS160_I2CADDR_1);
WiFiClientSecure net;
PubSubClient client(net);

// --- SHARED DATA (Thread Safe-ish via Volatile) ---
volatile float currentTemp = 0.0;
volatile float currentHum = 0.0;
volatile int eco2 = 400;
volatile int tvoc = 0;
volatile int soilMoisture = 0;

// --- STATE VARIABLES ---
char deviceId[20]; // Unique Device ID derived from MAC
volatile bool pumpStatus = false;
volatile bool fanStatus = false;
volatile bool heaterStatus = false;
volatile bool wifiConnected = false;
volatile bool mqtttConnected = false;
volatile bool reconfigureWiFi = false;
volatile bool portalRunning = false;
volatile bool stopPortalRequest = false;
volatile bool btnRequest = false;
bool hasOfflineData = true; // Check on boot

// --- MANUAL MODE VARIABLES ---
volatile bool manualMode = false;   // false = Auto, true = Manual
volatile bool manualPump = false;   // Manual pump state
volatile bool manualFan = false;    // Manual fan state
volatile bool manualHeater = false; // Manual heater state

// --- WATER TANK LEVEL ---
volatile int waterTankLevel = 0; // Tank level percentage (0-100%)

// --- TASK HANDLES ---
void TaskReadSensors(void *pvParameters);
void TaskControlSystem(void *pvParameters);
void TaskConnectivity(void *pvParameters);
void TaskInterface(void *pvParameters);

// --- AWS CALLBACK ---
void messageHandler(char *topic, byte *payload, unsigned int length)
{
    // 1. Debug: Print the raw payload
    // FIX: Use Heap instead of Stack to prevent overflow with large payloads
    if (length > 10240)
    { // Limit to 10KB
        Serial.println("Payload too large!");
        return;
    }
    char *jsonStr = (char *)malloc(length + 1);
    if (!jsonStr)
    {
        Serial.println("Malloc failed");
        return;
    }
    memcpy(jsonStr, payload, length);
    jsonStr[length] = '\0';

    Serial.print("AWS CMD Topic: ");
    Serial.println(topic);
    Serial.print("AWS CMD Payload: ");
    Serial.println(jsonStr);

    StaticJsonDocument<1024> doc; // Increased size
    DeserializationError error = deserializeJson(doc, (const char *)jsonStr);

    if (error)
    {
        Serial.print("deserializeJson() failed: ");
        Serial.println(error.c_str());
        free(jsonStr); // FIX: Free memory
        return;
    }

    // 2. Configuration Updates
    bool configChanged = false;

    // Support both "temp_min" and "min_temp" keys
    if (doc.containsKey("temp_min") || doc.containsKey("min_temp"))
    {
        float val = doc.containsKey("temp_min") ? doc["temp_min"] : doc["min_temp"];
        if (val >= 0 && val <= 100)
        {
            // FIX: Flash Wear-Out Protection (Only write if changed)
            if (abs(TEMP_MIN_NIGHT - val) > 0.1)
            {
                TEMP_MIN_NIGHT = val;
                configChanged = true;
                preferences.putFloat("temp_min", TEMP_MIN_NIGHT);
            }
        }
    }

    if (doc.containsKey("temp_max") || doc.containsKey("max_temp"))
    {
        float val = doc.containsKey("temp_max") ? doc["temp_max"] : doc["max_temp"];
        if (val >= 0 && val <= 100)
        {
            if (abs(TEMP_MAX_DAY - val) > 0.1)
            {
                TEMP_MAX_DAY = val;
                configChanged = true;
                preferences.putFloat("temp_max", TEMP_MAX_DAY);
            }
        }
    }

    if (doc.containsKey("hum_max") || doc.containsKey("max_hum"))
    {
        float val = doc.containsKey("hum_max") ? doc["hum_max"] : doc["max_hum"];
        if (val >= 0 && val <= 100)
        {
            if (abs(HUM_MAX - val) > 0.1)
            {
                HUM_MAX = val;
                configChanged = true;
                preferences.putFloat("hum_max", HUM_MAX);
            }
        }
    }

    if (doc.containsKey("soil_dry"))
    {
        int val = doc["soil_dry"];
        if (val >= 0 && val <= 100)
        {
            if (SOIL_DRY != val)
            {
                SOIL_DRY = val;
                configChanged = true;
                preferences.putInt("soil_dry", SOIL_DRY);
            }
        }
    }
    if (doc.containsKey("soil_wet"))
    {
        int val = doc["soil_wet"];
        if (val >= 0 && val <= 100)
        {
            if (SOIL_WET != val)
            {
                SOIL_WET = val;
                configChanged = true;
                preferences.putInt("soil_wet", SOIL_WET);
            }
        }
    }

    if (doc.containsKey("tank_empty_dist"))
    {
        int val = doc["tank_empty_dist"];
        if (val > 0 && val < 1000)
        {
            if (TANK_EMPTY_DIST != val)
            {
                TANK_EMPTY_DIST = val;
                configChanged = true;
                preferences.putInt("tank_empty", TANK_EMPTY_DIST);
            }
        }
    }

    if (doc.containsKey("tank_full_dist"))
    {
        int val = doc["tank_full_dist"];
        if (val > 0 && val < 1000)
        {
            if (TANK_FULL_DIST != val)
            {
                TANK_FULL_DIST = val;
                configChanged = true;
                preferences.putInt("tank_full", TANK_FULL_DIST);
            }
        }
    }

    if (doc.containsKey("cal_air"))
    {
        int val = doc["cal_air"];
        if (AIR_VAL != val)
        {
            AIR_VAL = val;
            configChanged = true;
            preferences.putInt("cal_air", AIR_VAL);
        }
    }
    if (doc.containsKey("cal_water"))
    {
        int val = doc["cal_water"];
        if (WATER_VAL != val)
        {
            WATER_VAL = val;
            configChanged = true;
            preferences.putInt("cal_water", WATER_VAL);
        }
    }

    if (configChanged)
    {
        Serial.println("Configuration Updated & Saved!");
    }

    // 3. Control Commands (Manual Mode)
    if (doc.containsKey("mode"))
    {
        String m = doc["mode"];
        if (m == "MANUAL" || m == "manual" || m == "1")
        {
            manualMode = true;
        }
        else if (m == "AUTO" || m == "auto" || m == "0")
        {
            manualMode = false;
            manualPump = false;
            manualFan = false;
            manualHeater = false;
        }
        Serial.print("Mode set to: ");
        Serial.println(manualMode ? "MANUAL" : "AUTO");
    }

    if (doc.containsKey("pump"))
    {
        if (manualMode)
        {
            int val = doc["pump"]; // 0 or 1
            manualPump = (val == 1);
            Serial.print("Manual Pump: ");
            Serial.println(manualPump ? "ON" : "OFF");
        }
    }
    if (doc.containsKey("fan"))
    {
        if (manualMode)
        {
            int val = doc["fan"];
            manualFan = (val == 1);
            Serial.print("Manual Fan: ");
            Serial.println(manualFan ? "ON" : "OFF");
        }
    }
    if (doc.containsKey("heater"))
    {
        if (manualMode)
        {
            int val = doc["heater"];
            manualHeater = (val == 1);
            Serial.print("Manual Heater: ");
            Serial.println(manualHeater ? "ON" : "OFF");
        }
    }

    // Check for OTA Update
    if (doc.containsKey("update_url"))
    {
        const char *url = doc["update_url"];
        Serial.println("OTA Update Requested...");
        Serial.println(url);

        // Disable WDT for this task during update (prevent timeout)
        esp_task_wdt_delete(NULL);

        // Use a separate client for OTA to avoid messing up AWS certs
        WiFiClientSecure otaClient;
        otaClient.setInsecure(); // Allow any HTTPS server (GitHub, S3, etc.)

        // Configure to follow redirects (Important for GitHub)
        httpUpdate.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);

        t_httpUpdate_return ret = httpUpdate.update(otaClient, url);

        switch (ret)
        {
        case HTTP_UPDATE_FAILED:
            Serial.printf("HTTP_UPDATE_FAILED Error (%d): %s\n", httpUpdate.getLastError(), httpUpdate.getLastErrorString().c_str());
            // Re-enable WDT for this task
            esp_task_wdt_add(NULL);
            break;
        case HTTP_UPDATE_NO_UPDATES:
            Serial.println("HTTP_UPDATE_NO_UPDATES");
            break;
        case HTTP_UPDATE_OK:
            Serial.println("HTTP_UPDATE_OK");
            break;
        }
    }

    free(jsonStr); // FIX: Free memory
}

// --- INTERRUPT SERVICE ROUTINE (ISR) ---
void IRAM_ATTR isrResetButton()
{
    static unsigned long last_interrupt_time = 0;
    unsigned long interrupt_time = millis();
    // Debounce: 200ms
    if (interrupt_time - last_interrupt_time > 200)
    {
        btnRequest = true;
    }
    last_interrupt_time = interrupt_time;
}

// ==========================================
// 3. SETUP
// ==========================================
void setup()
{
    Serial.begin(115200);
    Serial.println(FIRMWARE_VERSION);

    // 0. Generate Unique Device ID
    uint64_t chipid = ESP.getEfuseMac();
    snprintf(deviceId, 20, "GH-%04X%08X", (uint16_t)(chipid >> 32), (uint32_t)chipid);
    Serial.print("Device ID: ");
    Serial.println(deviceId);

    // 1. Initialize Hardware (LCD, I2C, Pins)
    Wire.begin(21, 22);
    Wire.setTimeOut(3000); // FIX: Prevent I2C lockups
    lcd.init();
    lcd.backlight();
    lcd.setCursor(0, 0);
    lcd.print("Smart GreenHouse");
    lcd.setCursor(0, 1);
    lcd.print(deviceId); // Show ID on boot
    delay(2000);         // Let user see the ID
    lcd.setCursor(0, 1);
    lcd.print("System Starting...");

    pinMode(PIN_PUMP, OUTPUT);
    digitalWrite(PIN_PUMP, LOW);
    pinMode(PIN_FAN, OUTPUT);
    digitalWrite(PIN_FAN, LOW);
    pinMode(PIN_HEATER, OUTPUT);
    digitalWrite(PIN_HEATER, LOW);
    pinMode(PIN_RESET_BTN, INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(PIN_RESET_BTN), isrResetButton, FALLING);

    // 2. Load Preferences
    preferences.begin("greenhouse", false); // Namespace "greenhouse", Read/Write

    // --- ROLLBACK PROTECTION ---
    // If the system crashes repeatedly (3 times) after an update, roll back.
    int crashCount = preferences.getInt("crash_count", 0);
    if (crashCount >= 3)
    {
        if (Update.canRollBack())
        {
            Serial.println("CRITICAL: Too many crashes. Rolling back to previous firmware...");
            preferences.putInt("crash_count", 0); // Reset counter
            preferences.putBool("rb_happened", true); // Flag for reporting
            Update.rollBack();
            ESP.restart();
        }
        else
        {
            Serial.println("CRITICAL: Crashes detected but no rollback partition available.");
            preferences.putInt("crash_count", 0); // Reset to avoid infinite loop if no rollback
        }
    }
    // Increment crash count (will be cleared if we connect to AWS successfully)
    preferences.putInt("crash_count", crashCount + 1);

    TEMP_MIN_NIGHT = preferences.getFloat("temp_min", 20.0);
    TEMP_MAX_DAY = preferences.getFloat("temp_max", 30.0);
    HUM_MAX = preferences.getFloat("hum_max", 75.0);
    SOIL_DRY = preferences.getInt("soil_dry", 40);
    SOIL_WET = preferences.getInt("soil_wet", 70);
    TANK_EMPTY_DIST = preferences.getInt("tank_empty", 25);
    TANK_FULL_DIST = preferences.getInt("tank_full", 5);
    AIR_VAL = preferences.getInt("cal_air", 4095);
    WATER_VAL = preferences.getInt("cal_water", 1670);
    Serial.println("Config Loaded from NVS");

    // 3. Initialize File System
    if (!LittleFS.begin(true))
    {
        Serial.println("LittleFS Mount Failed");
    }
    else
    {
        Serial.println("LittleFS Mounted");

        // --- DEBUG: PRINT OFFLINE LOGS ---
        if (LittleFS.exists("/offline_log.txt"))
        {
            Serial.println("--- FOUND OFFLINE LOGS ---");
            File f = LittleFS.open("/offline_log.txt", "r");
            while (f.available())
                Serial.write(f.read());
            f.close();
            Serial.println("\n--- END LOGS ---");
        }
        if (LittleFS.exists("/processing.txt"))
        {
            Serial.println("--- FOUND PROCESSING LOGS ---");
            File f = LittleFS.open("/processing.txt", "r");
            while (f.available())
                Serial.write(f.read());
            f.close();
            Serial.println("\n--- END LOGS ---");
        }
    }

    // 4. Initialize Sensors
    bool sensorsOk = true;
    if (!aht.begin())
    {
        Serial.println("AHT Error");
        sensorsOk = false;
    }
    if (!ens160.begin())
    {
        Serial.println("ENS Error");
        sensorsOk = false;
    }
    else
        ens160.setMode(ENS160_OPMODE_STD);

    if (!sensorsOk)
    {
        lcd.setCursor(0, 1);
        lcd.print("Sensor Failure!");
        delay(2000);
    }

    // Initialize Watchdog (30s timeout)
    esp_task_wdt_init(30, true);
    

    // 4. Create RTOS Tasks
    // Core 1 (Application Logic)
    xTaskCreatePinnedToCore(TaskReadSensors, "Sensors", 4096, NULL, 1, NULL, 1);
    xTaskCreatePinnedToCore(TaskControlSystem, "Control", 4096, NULL, 2, NULL, 1);
    xTaskCreatePinnedToCore(TaskInterface, "UI", 4096, NULL, 1, NULL, 1);

    // Core 0 (WiFi/SSL/Radio)
    xTaskCreatePinnedToCore(TaskConnectivity, "AWS", 10240, NULL, 1, NULL, 0);
}

void loop()
{
    // Remove the default loopTask from Watchdog to prevent timeout
    esp_task_wdt_delete(NULL);
    vTaskDelete(NULL); // Now we can safely delete it
}

// ==========================================
// 4. TASKS
// ==========================================

// --- TASK 1: SENSOR READING ---
void TaskReadSensors(void *pvParameters)
{
    esp_task_wdt_add(NULL); // Add this task to WDT watch list
    for (;;)
    {
        esp_task_wdt_reset(); // Feed the watchdog
        // AHT21 Reading
        sensors_event_t humidity, temp;
        aht.getEvent(&humidity, &temp);
        currentTemp = temp.temperature;
        currentHum = humidity.relative_humidity;

        // ENS160 Reading
        if (ens160.available())
        {
            ens160.measure(true);
            ens160.measureRaw(true);
            eco2 = ens160.geteCO2();
            tvoc = ens160.getTVOC();
        }

        // Soil Moisture Mapping (for ESP32 12-bit)
        int rawADC = analogRead(PIN_SOIL);
        rawADC = constrain(rawADC, WATER_VAL, AIR_VAL);
        // Map inverted: High Raw = Dry(0%), Low Raw = Wet(100%)
        // If sensor logic is reversed, swap 0 and 100 below
        soilMoisture = map(rawADC, AIR_VAL, WATER_VAL, 0, 100);

        vTaskDelay(2000 / portTICK_PERIOD_MS);
    }
}

// --- TASK 2: INTELLIGENT CONTROL ---
void TaskControlSystem(void *pvParameters)
{
    esp_task_wdt_add(NULL); // Add to WDT
    pinMode(PIN_TRIG, OUTPUT);
    pinMode(PIN_ECHO, INPUT);

    // Tank dimensions (adjust these for tank)
    // const int TANK_EMPTY_DIST = 25;  // Distance when tank is empty (cm) - MOVED TO GLOBAL
    // const int TANK_FULL_DIST = 5;    // Distance when tank is full (cm) - MOVED TO GLOBAL

    for (;;)
    {
        esp_task_wdt_reset(); // Feed WDT
        // 1. Water Tank Level Check
        digitalWrite(PIN_TRIG, LOW);
        delayMicroseconds(2);
        digitalWrite(PIN_TRIG, HIGH);
        delayMicroseconds(10);
        digitalWrite(PIN_TRIG, LOW);

        // Add timeout of 30ms (approx 5 meters max distance) to prevent blocking
        long duration = pulseIn(PIN_ECHO, HIGH, 30000);

        int distanceCM = 0;
        if (duration == 0)
        {
            // Timeout occurred - Sensor disconnected or out of range
            // Assume tank is empty to be safe (prevent pump running dry)
            distanceCM = TANK_EMPTY_DIST;
        }
        else
        {
            distanceCM = duration * 0.034 / 2;
        }

        // Calculate tank level percentage (inverted: less distance = more water)
        distanceCM = constrain(distanceCM, TANK_FULL_DIST, TANK_EMPTY_DIST);
        waterTankLevel = map(distanceCM, TANK_EMPTY_DIST, TANK_FULL_DIST, 0, 100);

        // Tank is empty if distance > 25cm (sensor at top looking down)
        bool tankHasWater = (distanceCM < TANK_EMPTY_DIST);

        // Check if Manual or Auto mode
        if (manualMode)
        {
            // ========== MANUAL MODE ==========
            // Directly control based on manual switches from Web App / AWS
            digitalWrite(PIN_PUMP, manualPump ? HIGH : LOW);
            pumpStatus = manualPump;

            digitalWrite(PIN_FAN, manualFan ? HIGH : LOW);
            fanStatus = manualFan;

            digitalWrite(PIN_HEATER, manualHeater ? HIGH : LOW);
            heaterStatus = manualHeater;
        }
        else
        {
            // ========== AUTO MODE (Default) ==========
            // 2. Irrigation Control (Hysteresis)
            if (soilMoisture < SOIL_DRY && tankHasWater)
            {
                digitalWrite(PIN_PUMP, HIGH); // Turn ON
                pumpStatus = true;
            }
            else if (soilMoisture > SOIL_WET || !tankHasWater)
            {
                digitalWrite(PIN_PUMP, LOW); // Turn OFF
                pumpStatus = false;
            }

            // 3. Climate Control
            // Fan: Turns on if too hot OR too humid
            if (currentTemp > TEMP_MAX_DAY || currentHum > HUM_MAX)
            {
                digitalWrite(PIN_FAN, HIGH);
                fanStatus = true;
            }
            else
            {
                digitalWrite(PIN_FAN, LOW);
                fanStatus = false;
            }

            // Heater: Turns on if too cold (Critical for Welimada nights)
            if (currentTemp < TEMP_MIN_NIGHT)
            {
                digitalWrite(PIN_HEATER, HIGH);
                heaterStatus = true;
            }
            else
            {
                digitalWrite(PIN_HEATER, LOW);
                heaterStatus = false;
            }
        }

        vTaskDelay(1000 / portTICK_PERIOD_MS);
    }
}

// --- TASK 3: USER INTERFACE ---
void TaskInterface(void *pvParameters)
{
    unsigned long lastLcdUpdate = 0;

    for (;;)
    {
        // Check Button Flag from ISR
        if (btnRequest)
        {
            btnRequest = false;
            if (portalRunning)
            {
                stopPortalRequest = true;
                lcd.setCursor(0, 0);
                lcd.print("Exiting Setup...    ");
            }
            else
            {
                reconfigureWiFi = true;
                // Immediate Feedback
                lcd.setCursor(0, 0);
                lcd.print("Entering Setup...   ");
                lcd.setCursor(0, 1);
                lcd.print("Please Wait...      ");
                lcd.setCursor(0, 2);
                lcd.print("                    ");
                lcd.setCursor(0, 3);
                lcd.print("                    ");

                // We do NOT disconnect here anymore, to allow simultaneous operation
                // WiFi.disconnect();
            }
        }

        // Update LCD every 500ms
        if (millis() - lastLcdUpdate > 500)
        {
            lastLcdUpdate = millis();

            if (portalRunning || reconfigureWiFi)
            {
                lcd.setCursor(0, 0);
                lcd.print("WiFi Setup Mode     ");
                lcd.setCursor(0, 1);
                lcd.print("Connect to AP:      ");
                lcd.setCursor(0, 2);
                lcd.print("Greenhouse-Setup    ");
                lcd.setCursor(0, 3);
                lcd.print("                    ");
            }
            else
            {
                // Line 0: Temp & Heater
                lcd.setCursor(0, 0);
                lcd.printf("Temp:%4.1fC  Heat:%s", currentTemp, heaterStatus ? "ON " : "OFF");

                // Line 1: Humidity & Fan
                lcd.setCursor(0, 1);
                lcd.printf("Hum :%3d%%   Fan :%s", (int)currentHum, fanStatus ? "ON " : "OFF");

                // Line 2: Soil & Pump
                lcd.setCursor(0, 2);
                lcd.printf("Soil:%3d%%   Pump:%s", soilMoisture, pumpStatus ? "ON " : "OFF");

                // Line 3: CO2 & MQTT Status
                lcd.setCursor(0, 3);
                if (mqttConnected)
                {
                    lcd.printf("CO2 :%-4d  MQTT:ON ", eco2);
                }
                else if (wifiConnected)
                {
                    lcd.printf("CO2 :%-4d   AWS :CON", eco2);
                }
                else
                {
                    lcd.printf("CO2 :%-4d   AWS :OFF", eco2);
                }
            }
        }

        vTaskDelay(100 / portTICK_PERIOD_MS);
    }
}

// --- DATA LOGGING HELPER FUNCTIONS ---
String ramBuffer = "";
int ramBufferCount = 0;
const int RAM_BUFFER_SIZE = 50; // Write to flash every ~4 minutes (50 * 5s)

void flushRamBuffer()
{
    if (ramBufferCount > 0)
    {
        File file = LittleFS.open("/offline_log.txt", FILE_APPEND);
        if (!file)
        {
            Serial.println("Failed to open log file for flushing");
            return;
        }
        file.print(ramBuffer);
        file.close();
        Serial.println("RAM Buffer Flushed to Flash");

        ramBuffer = "";
        ramBufferCount = 0;
        hasOfflineData = true;
    }
}

void logDataOffline(const char *jsonString)
{
    // Buffer in RAM first
    ramBuffer += String(jsonString) + "\n";
    ramBufferCount++;

    Serial.printf("Offline Data Buffered: %d/%d\n", ramBufferCount, RAM_BUFFER_SIZE);

    // Only write to Flash if buffer is full
    if (ramBufferCount >= RAM_BUFFER_SIZE)
    {
        flushRamBuffer();
    }
}

void processOfflineData()
{
    if (!hasOfflineData)
        return; // Skip if we know there's nothing

    bool foundProcessing = false;
    bool foundLog = false;

    // Use directory listing to check for files to avoid "does not exist" error logs
    File root = LittleFS.open("/");
    if (!root)
        return;

    File file = root.openNextFile();
    while (file)
    {
        String fileName = file.name();
        if (fileName.indexOf("processing.txt") >= 0)
            foundProcessing = true;
        if (fileName.indexOf("offline_log.txt") >= 0)
            foundLog = true;
        file = root.openNextFile();
    }
    root.close();

    // If neither file exists, update flag and return
    if (!foundProcessing && !foundLog)
    {
        hasOfflineData = false;
        return;
    }

    // 1. Check if we have a pending processing file from a previous failed attempt
    if (foundProcessing)
    {
        File file = LittleFS.open("/processing.txt", FILE_READ);
        if (file)
        {
            Serial.println("Retrying Offline Data Upload...");
            bool allSent = true;
            while (file.available())
            {
                String line = file.readStringUntil('\n');
                line.trim();
                if (line.length() > 0)
                {
                    char topic[50];
                    snprintf(topic, sizeof(topic), "greenhouse/%s/data", deviceId);
                    if (!client.connected() || !client.publish(topic, line.c_str()))
                    {
                        allSent = false;
                        break;
                    }
                    delay(50);
                }
            }
            file.close();
            if (allSent)
            {
                LittleFS.remove("/processing.txt");
                Serial.println("Old Offline Data Cleared");
            }
            else
            {
                return; // Stop if we failed again
            }
        }
    }

    // 2. Check for new offline data
    if (foundLog)
    {
        LittleFS.rename("/offline_log.txt", "/processing.txt");
        // Recursive call to process the newly renamed file
        processOfflineData();
    }
}

// --- TASK 4: CLOUD CONNECTIVITY ---
void configModeCallback(WiFiManager *myWiFiManager)
{
    Serial.println("Entered config mode");
    portalRunning = true;
}

void TaskConnectivity(void *pvParameters)
{
    WiFiManager wm;
    wm.setAPCallback(configModeCallback);

    // --- NON-BLOCKING BOOT STRATEGY ---
    // 1. Don't block indefinitely. Try to connect for 10s.
    // 2. If fail, DO NOT start AP automatically. Just continue offline.
    // 3. AP is only started if user presses the button.

    wm.setConnectTimeout(10);          // Try to connect for 10 seconds
    wm.setEnableConfigPortal(false);   // Disable auto-AP on failure
    wm.setConfigPortalBlocking(false); // Ensure portal is non-blocking if we start it later

    Serial.println("Attempting WiFi Connection...");
    // FIX: Added password for security
    if (!wm.autoConnect("Greenhouse-Setup", "password123"))
    {
        Serial.println("WiFi not connected. Running in Offline Mode.");
        // Ensure we are in STA mode to allow background reconnection attempts
        WiFi.mode(WIFI_STA);
    }
    else
    {
        Serial.println("WiFi Connected!");
        wifiConnected = true;
    }
    portalRunning = false;

    // Load HiveMQ Certificates (Root CA Only)
    net.setCACert(ROOT_CA);
    // net.setCertificate(AWS_CERT_CRT); // Not needed for HiveMQ Password Auth
    // net.setPrivateKey(AWS_CERT_PRIVATE); // Not needed for HiveMQ Password Auth

    client.setServer(MQTT_BROKER, MQTT_PORT);
    client.setCallback(messageHandler);

    esp_task_wdt_add(NULL); // Add to WDT

    for (;;)
    {
        esp_task_wdt_reset(); // Feed WDT
        wm.process();         // Process WiFiManager (Non-blocking)
        portalRunning = wm.getConfigPortalActive();

        if (reconfigureWiFi)
        {
            Serial.println("Starting Config Portal (Non-Blocking)...");
            wm.setEnableConfigPortal(true); // Re-enable portal for manual start
            wm.setConfigPortalTimeout(120); // 2 minute timeout for manual setup
            // FIX: Added password for security
            wm.startConfigPortal("Greenhouse-Setup", "password123");
            reconfigureWiFi = false;
        }

        if (stopPortalRequest)
        {
            Serial.println("Stopping Config Portal...");
            wm.stopConfigPortal();
            stopPortalRequest = false;
            vTaskDelay(100 / portTICK_PERIOD_MS); // Allow stack to settle
        }

        // Run Cloud tasks if WiFi is Connected (Even if Portal is running)
        if (WiFi.status() == WL_CONNECTED)
        {
            wifiConnected = true;

            // NTP Time Sync (Required for AWS SSL)
            time_t now = time(nullptr);
            if (now < 8 * 3600 * 2)
            {
                configTime(0, 0, "pool.ntp.org", "time.nist.gov");
            }

            if (!client.connected())
            {
                mqttConnected = false;
                // Only try to connect to AWS occasionally to avoid spamming logs/blocking
                static unsigned long lastMqttAttempt = 0;
                if (millis() - lastMqttAttempt > 5000)
                {
                    lastMqttAttempt = millis();
                    Serial.printf("HiveMQ Connecting (User: %s)...", MQTT_USER);
                    // Connect with User/Pass
                    if (client.connect(deviceId, MQTT_USER, MQTT_PASSWORD))
                    {
                        Serial.println("CONNECTED");
                        char topic[50];
                        snprintf(topic, sizeof(topic), "greenhouse/%s/commands", deviceId);
                        client.subscribe(topic);
                        mqttConnected = true;

                        // FIX: Mark boot as successful (reset crash count)
                        if (preferences.getInt("crash_count", 0) > 0)
                        {
                            preferences.putInt("crash_count", 0);
                            Serial.println("Boot Verified: Crash Count Reset");
                        }

                        // --- REPORT ROLLBACK ---
                        if (preferences.getBool("rb_happened", false)) {
                            char alertTopic[50];
                            snprintf(alertTopic, sizeof(alertTopic), "greenhouse/%s/alerts", deviceId);
                            
                            char alertMsg[256];
                            snprintf(alertMsg, sizeof(alertMsg), "{\"alert\": \"ROLLBACK_EXECUTED\", \"message\": \"System restored to previous version after 3 crashes.\", \"timestamp\": %lu}", (unsigned long)time(nullptr));
                            
                            if (client.publish(alertTopic, alertMsg)) {
                                Serial.println("Rollback Alert Published Successfully");
                                preferences.putBool("rb_happened", false); // Clear flag only on success
                            } else {
                                Serial.println("Rollback Alert Publish FAILED");
                            }
                        }
                    }
                    else
                    {
                        Serial.print("Failed: ");
                        Serial.println(client.state());
                    }
                }
            }
            else
            {
                mqttConnected = true;
                client.loop();
            }
        }
        else
        {
            // WiFi Lost
            if (!portalRunning)
            {
                wifiConnected = false;
                mqttConnected = false;

                // --- SELF-HEALING: Auto-Reconnect Strategy ---
                // If the router was off during boot (Power Cut), the ESP32 enters Offline Mode.
                // We need to periodically check if the router is back online.
                static unsigned long lastWifiRetry = 0;
                if (millis() - lastWifiRetry > 30000)
                { // Check every 30 seconds
                    lastWifiRetry = millis();
                    Serial.println("Offline: Attempting background reconnection...");

                    // This forces the ESP32 to try connecting with saved credentials
                    WiFi.reconnect();
                }
            }
        }

        // Unified Data Logging & Publishing (Runs regardless of WiFi)
        static unsigned long lastDataGen = 0;
        if (millis() - lastDataGen > 5000)
        {
            char jsonBuffer[512]; // Increased buffer size
            snprintf(jsonBuffer, sizeof(jsonBuffer),
                     "{\"device_id\": \"%s\", \"version\": \"%s\", \"timestamp\": %lu, \"temp\": %.1f, \"hum\": %.1f, \"soil\": %d, \"co2\": %d, \"tvoc\": %d, \"tank_level\": %d, \"pump\": %d, \"fan\": %d, \"heater\": %d, \"mode\": \"%s\"}",
                     deviceId, FIRMWARE_VERSION, (unsigned long)time(nullptr),
                     currentTemp, currentHum, soilMoisture, eco2, tvoc, waterTankLevel,
                     pumpStatus ? 1 : 0, fanStatus ? 1 : 0, heaterStatus ? 1 : 0,
                     manualMode ? "MANUAL" : "AUTO");

            if (wifiConnected && mqttConnected)
            {
                char topic[50];
                snprintf(topic, sizeof(topic), "greenhouse/%s/data", deviceId);
                client.publish(topic, jsonBuffer);
                Serial.println("Published Data");

                // Flush any pending RAM buffer to disk so it can be uploaded
                if (ramBufferCount > 0)
                    flushRamBuffer();

                // Also check for offline data upload here
                processOfflineData();
            }
            else
            {
                // If AWS is down (even if WiFi is up), log locally
                logDataOffline(jsonBuffer);
            }
            lastDataGen = millis();
        }

        vTaskDelay(50 / portTICK_PERIOD_MS); // Yield to other tasks
    }
}