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
#include "secrets.h"

#define BLYNK_PRINT Serial
#include <BlynkSimpleEsp32.h>

// ==========================================
// BLYNK VIRTUAL PINS
// ==========================================
// Display Pins (Read-only on app)
#define VPIN_TEMP       V0   // Temperature display
#define VPIN_HUM        V1   // Humidity display
#define VPIN_SOIL       V2   // Soil moisture display
#define VPIN_CO2        V3   // CO2 display
#define VPIN_PUMP_LED   V4   // Pump status LED
#define VPIN_FAN_LED    V5   // Fan status LED
#define VPIN_HEATER_LED V6   // Heater status LED
#define VPIN_TANK_LEVEL V7   // Water tank level display

// Control Pins (Write from app)
#define VPIN_MODE       V10  // Auto/Manual switch (0=Auto, 1=Manual)
#define VPIN_PUMP_BTN   V11  // Manual Pump control
#define VPIN_FAN_BTN    V12  // Manual Fan control
#define VPIN_HEATER_BTN V13  // Manual Heater control 

// Configuration Pins (Write from app)
#define VPIN_SET_TEMP_MIN V20
#define VPIN_SET_TEMP_MAX V21
#define VPIN_SET_SOIL_DRY V22
#define VPIN_SET_SOIL_WET V23
#define VPIN_CAL_AIR      V24 // Button to set current reading as Air (Dry)
#define VPIN_CAL_WATER    V25 // Button to set current reading as Water (Wet)

// ==========================================
// 1. CONFIGURATION & PINOUT
// ==========================================

Preferences preferences;

// --- CONFIGURABLE PARAMETERS (Loaded from NVS) ---
float TEMP_MIN_NIGHT = 20.0;  // Heater ON below this
float TEMP_MAX_DAY   = 30.0;  // Fan ON above this
float HUM_MAX        = 75.0;  // Fan ON above this
int   SOIL_DRY       = 40;    // Pump ON below this %
int   SOIL_WET       = 70;    // Pump OFF above this %

// --- SENSOR CALIBRATION (ESP32 is 12-bit: 0-4095) ---
int AIR_VAL   = 4095;    
int WATER_VAL = 1670;  

// --- PIN DEFINITIONS ---
#define PIN_PUMP        26  // Water Pump Relay
#define PIN_FAN         27  // Exhaust Fan Relay
#define PIN_HEATER      14  // Heater / Halogen Lamp Relay
#define PIN_TRIG        5   // Ultrasonic Trig
#define PIN_ECHO        34  // Ultrasonic Echo
#define PIN_SOIL        32  // Soil Moisture Analog
#define PIN_RESET_BTN   4  // Boot Button (Hold 5s to reset WiFi)

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
volatile bool pumpStatus = false;
volatile bool fanStatus = false;   
volatile bool heaterStatus = false; 
volatile bool wifiConnected = false;
volatile bool awsConnected = false;
volatile bool reconfigureWiFi = false;
volatile bool portalRunning = false;
volatile bool stopPortalRequest = false;
volatile bool btnRequest = false;
bool hasOfflineData = true; // Check on boot

// --- MANUAL MODE VARIABLES ---
volatile bool manualMode = false;      // false = Auto, true = Manual
volatile bool manualPump = false;      // Manual pump state
volatile bool manualFan = false;       // Manual fan state
volatile bool manualHeater = false;    // Manual heater state

// --- WATER TANK LEVEL ---
volatile int waterTankLevel = 0;       // Tank level percentage (0-100%)

// --- TASK HANDLES ---
void TaskReadSensors(void *pvParameters);
void TaskControlSystem(void *pvParameters);
void TaskConnectivity(void *pvParameters);
void TaskInterface(void *pvParameters);

// --- AWS CALLBACK ---
void messageHandler(char* topic, byte* payload, unsigned int length) {
  // 1. Debug: Print the raw payload
  char jsonStr[length + 1];
  memcpy(jsonStr, payload, length);
  jsonStr[length] = '\0';
  
  Serial.print("AWS CMD Topic: "); Serial.println(topic);
  Serial.print("AWS CMD Payload: "); Serial.println(jsonStr);
  
  StaticJsonDocument<512> doc; // Increased size just in case
  DeserializationError error = deserializeJson(doc, jsonStr);

  if (error) {
    Serial.print("deserializeJson() failed: ");
    Serial.println(error.c_str());
    return;
  }

  // 2. Configuration Updates
  bool configChanged = false;
  
  // Support both "temp_min" and "min_temp" keys
  if (doc.containsKey("temp_min")) { TEMP_MIN_NIGHT = doc["temp_min"]; configChanged = true; preferences.putFloat("temp_min", TEMP_MIN_NIGHT); }
  else if (doc.containsKey("min_temp")) { TEMP_MIN_NIGHT = doc["min_temp"]; configChanged = true; preferences.putFloat("temp_min", TEMP_MIN_NIGHT); }

  if (doc.containsKey("temp_max")) { TEMP_MAX_DAY = doc["temp_max"]; configChanged = true; preferences.putFloat("temp_max", TEMP_MAX_DAY); }
  else if (doc.containsKey("max_temp")) { TEMP_MAX_DAY = doc["max_temp"]; configChanged = true; preferences.putFloat("temp_max", TEMP_MAX_DAY); }

  if (doc.containsKey("hum_max")) { HUM_MAX = doc["hum_max"]; configChanged = true; preferences.putFloat("hum_max", HUM_MAX); }
  else if (doc.containsKey("max_hum")) { HUM_MAX = doc["max_hum"]; configChanged = true; preferences.putFloat("hum_max", HUM_MAX); }

  if (doc.containsKey("soil_dry")) { SOIL_DRY = doc["soil_dry"]; configChanged = true; preferences.putInt("soil_dry", SOIL_DRY); }
  if (doc.containsKey("soil_wet")) { SOIL_WET = doc["soil_wet"]; configChanged = true; preferences.putInt("soil_wet", SOIL_WET); }
  
  if (doc.containsKey("cal_air")) { AIR_VAL = doc["cal_air"]; configChanged = true; preferences.putInt("cal_air", AIR_VAL); }
  if (doc.containsKey("cal_water")) { WATER_VAL = doc["cal_water"]; configChanged = true; preferences.putInt("cal_water", WATER_VAL); }
  
  if (configChanged) {
    Serial.println("Configuration Updated & Saved!");
    // Update Blynk sliders to match new values
    Blynk.virtualWrite(VPIN_SET_TEMP_MIN, TEMP_MIN_NIGHT);
    Blynk.virtualWrite(VPIN_SET_TEMP_MAX, TEMP_MAX_DAY);
    Blynk.virtualWrite(VPIN_SET_SOIL_DRY, SOIL_DRY);
    Blynk.virtualWrite(VPIN_SET_SOIL_WET, SOIL_WET);
  }

  // 3. Control Commands (Manual Mode)
  if (doc.containsKey("mode")) {
      String m = doc["mode"];
      if (m == "MANUAL" || m == "manual" || m == "1") {
          manualMode = true;
      } else if (m == "AUTO" || m == "auto" || m == "0") {
          manualMode = false;
          manualPump = false; manualFan = false; manualHeater = false;
      }
      Serial.print("Mode set to: "); Serial.println(manualMode ? "MANUAL" : "AUTO");
      Blynk.virtualWrite(VPIN_MODE, manualMode ? 1 : 0);
  }

  if (doc.containsKey("pump")) {
      if (manualMode) {
          int val = doc["pump"]; // 0 or 1
          manualPump = (val == 1);
          Serial.print("Manual Pump: "); Serial.println(manualPump ? "ON" : "OFF");
          Blynk.virtualWrite(VPIN_PUMP_BTN, manualPump ? 1 : 0);
      }
  }
  if (doc.containsKey("fan")) {
      if (manualMode) {
          int val = doc["fan"];
          manualFan = (val == 1);
          Serial.print("Manual Fan: "); Serial.println(manualFan ? "ON" : "OFF");
          Blynk.virtualWrite(VPIN_FAN_BTN, manualFan ? 1 : 0);
      }
  }
  if (doc.containsKey("heater")) {
      if (manualMode) {
          int val = doc["heater"];
          manualHeater = (val == 1);
          Serial.print("Manual Heater: "); Serial.println(manualHeater ? "ON" : "OFF");
          Blynk.virtualWrite(VPIN_HEATER_BTN, manualHeater ? 1 : 0);
      }
  }

  // Check for OTA Update
  if (doc.containsKey("update_url")) {
      const char* url = doc["update_url"];
      Serial.println("OTA Update Requested...");
      Serial.println(url);
      
      // Disable WDT for update
      esp_task_wdt_deinit();
      
      t_httpUpdate_return ret = httpUpdate.update(net, url);

      switch (ret) {
        case HTTP_UPDATE_FAILED:
          Serial.printf("HTTP_UPDATE_FAILED Error (%d): %s\n", httpUpdate.getLastError(), httpUpdate.getLastErrorString().c_str());
          // Re-enable WDT
          esp_task_wdt_init(30, true);
          break;
        case HTTP_UPDATE_NO_UPDATES:
          Serial.println("HTTP_UPDATE_NO_UPDATES");
          break;
        case HTTP_UPDATE_OK:
          Serial.println("HTTP_UPDATE_OK");
          break;
      }
  }
}

// --- INTERRUPT SERVICE ROUTINE (ISR) ---
void IRAM_ATTR isrResetButton() {
    static unsigned long last_interrupt_time = 0;
    unsigned long interrupt_time = millis();
    // Debounce: 200ms
    if (interrupt_time - last_interrupt_time > 200) {
        btnRequest = true;
    }
    last_interrupt_time = interrupt_time;
}

// ==========================================
// BLYNK HANDLERS
// ==========================================

// Mode Switch Handler (V10)
BLYNK_WRITE(VPIN_MODE) {
  manualMode = param.asInt();
  Serial.print("Mode: "); Serial.println(manualMode ? "MANUAL" : "AUTO");
  
  // When switching to Auto, turn off manual controls
  if (!manualMode) {
    manualPump = false;
    manualFan = false;
    manualHeater = false;
    // Update button states on app
    Blynk.virtualWrite(VPIN_PUMP_BTN, 0);
    Blynk.virtualWrite(VPIN_FAN_BTN, 0);
    Blynk.virtualWrite(VPIN_HEATER_BTN, 0);
  }
}

// Manual Pump Control (V11)
BLYNK_WRITE(VPIN_PUMP_BTN) {
  if (manualMode) {
    manualPump = param.asInt();
    Serial.print("Manual Pump: "); Serial.println(manualPump ? "ON" : "OFF");
  } else {
    // Reset button if not in manual mode
    Blynk.virtualWrite(VPIN_PUMP_BTN, 0);
  }
}

// Manual Fan Control (V12)
BLYNK_WRITE(VPIN_FAN_BTN) {
  if (manualMode) {
    manualFan = param.asInt();
    Serial.print("Manual Fan: "); Serial.println(manualFan ? "ON" : "OFF");
  } else {
    // Reset button if not in manual mode
    Blynk.virtualWrite(VPIN_FAN_BTN, 0);
  }
}

// Manual Heater Control (V13)
BLYNK_WRITE(VPIN_HEATER_BTN) {
  if (manualMode) {
    manualHeater = param.asInt();
    Serial.print("Manual Heater: "); Serial.println(manualHeater ? "ON" : "OFF");
  } else {
    // Reset button if not in manual mode
    Blynk.virtualWrite(VPIN_HEATER_BTN, 0);
  }
}

// --- CONFIGURATION HANDLERS ---
BLYNK_WRITE(VPIN_SET_TEMP_MIN) {
  TEMP_MIN_NIGHT = param.asFloat();
  preferences.putFloat("temp_min", TEMP_MIN_NIGHT);
  Serial.print("Set Min Temp: "); Serial.println(TEMP_MIN_NIGHT);
}

BLYNK_WRITE(VPIN_SET_TEMP_MAX) {
  TEMP_MAX_DAY = param.asFloat();
  preferences.putFloat("temp_max", TEMP_MAX_DAY);
  Serial.print("Set Max Temp: "); Serial.println(TEMP_MAX_DAY);
}

BLYNK_WRITE(VPIN_SET_SOIL_DRY) {
  SOIL_DRY = param.asInt();
  preferences.putInt("soil_dry", SOIL_DRY);
  Serial.print("Set Soil Dry: "); Serial.println(SOIL_DRY);
}

BLYNK_WRITE(VPIN_SET_SOIL_WET) {
  SOIL_WET = param.asInt();
  preferences.putInt("soil_wet", SOIL_WET);
  Serial.print("Set Soil Wet: "); Serial.println(SOIL_WET);
}

BLYNK_WRITE(VPIN_CAL_AIR) {
  if (param.asInt() == 1) {
      int raw = analogRead(PIN_SOIL);
      AIR_VAL = raw;
      preferences.putInt("cal_air", AIR_VAL);
      Serial.print("Calibrated Air (Dry): "); Serial.println(AIR_VAL);
  }
}

BLYNK_WRITE(VPIN_CAL_WATER) {
  if (param.asInt() == 1) {
      int raw = analogRead(PIN_SOIL);
      WATER_VAL = raw;
      preferences.putInt("cal_water", WATER_VAL);
      Serial.print("Calibrated Water (Wet): "); Serial.println(WATER_VAL);
  }
}

// Sync mode state when app connects
BLYNK_CONNECTED() {
  Serial.println("Blynk Connected!");
  Blynk.syncVirtual(VPIN_MODE);
  Blynk.syncVirtual(VPIN_SET_TEMP_MIN);
  Blynk.syncVirtual(VPIN_SET_TEMP_MAX);
  Blynk.syncVirtual(VPIN_SET_SOIL_DRY);
  Blynk.syncVirtual(VPIN_SET_SOIL_WET);
}

// ==========================================
// 3. SETUP
// ==========================================
void setup() {
  Serial.begin(115200);
  
  // 1. Initialize Hardware (LCD, I2C, Pins)
  Wire.begin(21, 22);
  lcd.init(); 
  lcd.backlight();
  lcd.setCursor(0, 0); lcd.print("Smart GreenHouse");
  lcd.setCursor(0, 1); lcd.print("System Starting...");

  pinMode(PIN_PUMP, OUTPUT); digitalWrite(PIN_PUMP, LOW);
  pinMode(PIN_FAN, OUTPUT); digitalWrite(PIN_FAN, LOW);
  pinMode(PIN_HEATER, OUTPUT); digitalWrite(PIN_HEATER, LOW);
  pinMode(PIN_RESET_BTN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_RESET_BTN), isrResetButton, FALLING);

  // 2. Load Preferences
  preferences.begin("greenhouse", false); // Namespace "greenhouse", Read/Write
  TEMP_MIN_NIGHT = preferences.getFloat("temp_min", 20.0);
  TEMP_MAX_DAY   = preferences.getFloat("temp_max", 30.0);
  HUM_MAX        = preferences.getFloat("hum_max", 75.0);
  SOIL_DRY       = preferences.getInt("soil_dry", 40);
  SOIL_WET       = preferences.getInt("soil_wet", 70);
  AIR_VAL        = preferences.getInt("cal_air", 4095);
  WATER_VAL      = preferences.getInt("cal_water", 1670);
  Serial.println("Config Loaded from NVS");

  // 3. Initialize File System
  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS Mount Failed");
  } else {
    Serial.println("LittleFS Mounted");
    
    // --- DEBUG: PRINT OFFLINE LOGS ---
    if (LittleFS.exists("/offline_log.txt")) {
        Serial.println("--- FOUND OFFLINE LOGS ---");
        File f = LittleFS.open("/offline_log.txt", "r");
        while (f.available()) Serial.write(f.read());
        f.close();
        Serial.println("\n--- END LOGS ---");
    }
    if (LittleFS.exists("/processing.txt")) {
        Serial.println("--- FOUND PROCESSING LOGS ---");
        File f = LittleFS.open("/processing.txt", "r");
        while (f.available()) Serial.write(f.read());
        f.close();
        Serial.println("\n--- END LOGS ---");
    }
  }

  // 4. Initialize Sensors
  bool sensorsOk = true;
  if (!aht.begin()) { Serial.println("AHT Error"); sensorsOk = false; }
  if (!ens160.begin()) { Serial.println("ENS Error"); sensorsOk = false; }
  else ens160.setMode(ENS160_OPMODE_STD);

  if(!sensorsOk) {
    lcd.setCursor(0, 1); lcd.print("Sensor Failure!");
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

void loop() {
  // Remove the default loopTask from Watchdog to prevent timeout
  esp_task_wdt_delete(NULL);
  vTaskDelete(NULL); // Now we can safely delete it
}

// ==========================================
// 4. TASKS
// ==========================================

// --- TASK 1: SENSOR READING ---
void TaskReadSensors(void *pvParameters) {
  esp_task_wdt_add(NULL); // Add this task to WDT watch list
  for (;;) {
    esp_task_wdt_reset(); // Feed the watchdog
    // AHT21 Reading
    sensors_event_t humidity, temp;
    aht.getEvent(&humidity, &temp); 
    currentTemp = temp.temperature;
    currentHum = humidity.relative_humidity;
    
    // ENS160 Reading
    if (ens160.available()) {
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
void TaskControlSystem(void *pvParameters) {
  esp_task_wdt_add(NULL); // Add to WDT
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  
  // Tank dimensions (adjust these for tank)
  const int TANK_EMPTY_DIST = 25;  // Distance when tank is empty (cm)
  const int TANK_FULL_DIST = 5;    // Distance when tank is full (cm)
  
  for (;;) {
    esp_task_wdt_reset(); // Feed WDT
    // 1. Water Tank Level Check
    digitalWrite(PIN_TRIG, LOW); delayMicroseconds(2);
    digitalWrite(PIN_TRIG, HIGH); delayMicroseconds(10);
    digitalWrite(PIN_TRIG, LOW);
    long duration = pulseIn(PIN_ECHO, HIGH);
    int distanceCM = duration * 0.034 / 2;
    
    // Calculate tank level percentage (inverted: less distance = more water)
    distanceCM = constrain(distanceCM, TANK_FULL_DIST, TANK_EMPTY_DIST);
    waterTankLevel = map(distanceCM, TANK_EMPTY_DIST, TANK_FULL_DIST, 0, 100);
    
    // Tank is empty if distance > 25cm (sensor at top looking down)
    bool tankHasWater = (distanceCM < TANK_EMPTY_DIST); 

    // Check if Manual or Auto mode
    if (manualMode) {
      // ========== MANUAL MODE ==========
      // Directly control based on manual switches from Blynk app
      digitalWrite(PIN_PUMP, manualPump ? HIGH : LOW);
      pumpStatus = manualPump;
      
      digitalWrite(PIN_FAN, manualFan ? HIGH : LOW);
      fanStatus = manualFan;
      
      digitalWrite(PIN_HEATER, manualHeater ? HIGH : LOW);
      heaterStatus = manualHeater;
      
    } else {
      // ========== AUTO MODE (Default) ==========
      // 2. Irrigation Control (Hysteresis)
      if (soilMoisture < SOIL_DRY && tankHasWater) {
         digitalWrite(PIN_PUMP, HIGH); // Turn ON
         pumpStatus = true;
      } else if (soilMoisture > SOIL_WET || !tankHasWater) {
         digitalWrite(PIN_PUMP, LOW);  // Turn OFF
         pumpStatus = false;
      }

      // 3. Climate Control
      // Fan: Turns on if too hot OR too humid
      if (currentTemp > TEMP_MAX_DAY || currentHum > HUM_MAX) {
          digitalWrite(PIN_FAN, HIGH);
          fanStatus = true;
      } else {
          digitalWrite(PIN_FAN, LOW);
          fanStatus = false;
      }

      // Heater: Turns on if too cold (Critical for Welimada nights)
      if (currentTemp < TEMP_MIN_NIGHT) {
          digitalWrite(PIN_HEATER, HIGH);
          heaterStatus = true;
      } else {
          digitalWrite(PIN_HEATER, LOW);
          heaterStatus = false;
      }
    }
    
    vTaskDelay(1000 / portTICK_PERIOD_MS);
  }
}

// --- TASK 3: USER INTERFACE ---
void TaskInterface(void *pvParameters) {
  unsigned long lastLcdUpdate = 0;

  for (;;) {
    // Check Button Flag from ISR
    if (btnRequest) {
        btnRequest = false;
        if (portalRunning) {
            stopPortalRequest = true;
            lcd.setCursor(0, 0); lcd.print("Exiting Setup...    ");
        } else {
            reconfigureWiFi = true;
            // Immediate Feedback
            lcd.setCursor(0, 0); lcd.print("Entering Setup...   ");
            lcd.setCursor(0, 1); lcd.print("Please Wait...      ");
            lcd.setCursor(0, 2); lcd.print("                    ");
            lcd.setCursor(0, 3); lcd.print("                    ");
            
            // We do NOT disconnect here anymore, to allow simultaneous operation
            // WiFi.disconnect(); 
        }
    }

    // Update LCD every 500ms
    if (millis() - lastLcdUpdate > 500) {
        lastLcdUpdate = millis();

        if (portalRunning || reconfigureWiFi) {
            lcd.setCursor(0, 0); lcd.print("WiFi Setup Mode     ");
            lcd.setCursor(0, 1); lcd.print("Connect to AP:      ");
            lcd.setCursor(0, 2); lcd.print("Greenhouse-Setup    ");
            lcd.setCursor(0, 3); lcd.print("                    ");
        } else {
            // Line 0: Temp & Heater
            lcd.setCursor(0, 0);
            lcd.printf("Temp:%4.1fC  Heat:%s", currentTemp, heaterStatus ? "ON " : "OFF");
            
            // Line 1: Humidity & Fan
            lcd.setCursor(0, 1);
            lcd.printf("Hum :%3d%%   Fan :%s", (int)currentHum, fanStatus ? "ON " : "OFF");

            // Line 2: Soil & Pump
            lcd.setCursor(0, 2);
            lcd.printf("Soil:%3d%%   Pump:%s", soilMoisture, pumpStatus ? "ON " : "OFF");

            // Line 3: CO2 & AWS Status
            lcd.setCursor(0, 3);
            if (awsConnected) {
                lcd.printf("CO2 :%-4d   AWS :ON ", eco2);
            } else if (wifiConnected) {
                lcd.printf("CO2 :%-4d   AWS :CON", eco2);
            } else {
                lcd.printf("CO2 :%-4d   AWS :OFF", eco2);
            }
        }
    }

    vTaskDelay(100 / portTICK_PERIOD_MS); 
  }
}

// --- DATA LOGGING HELPER FUNCTIONS ---
void logDataOffline(const char* jsonString) {
  File file = LittleFS.open("/offline_log.txt", FILE_APPEND);
  if (!file) {
    Serial.println("Failed to open log file");
    return;
  }
  file.println(jsonString);
  file.close();
  Serial.println("Data Logged Offline");
  hasOfflineData = true; // Flag to process later
}

void processOfflineData() {
  if (!hasOfflineData) return; // Skip if we know there's nothing

  bool foundProcessing = false;
  bool foundLog = false;

  // Use directory listing to check for files to avoid "does not exist" error logs
  File root = LittleFS.open("/");
  if (!root) return;

  File file = root.openNextFile();
  while(file){
      String fileName = file.name();
      if(fileName.indexOf("processing.txt") >= 0) foundProcessing = true;
      if(fileName.indexOf("offline_log.txt") >= 0) foundLog = true;
      file = root.openNextFile();
  }
  root.close();

  // If neither file exists, update flag and return
  if (!foundProcessing && !foundLog) {
      hasOfflineData = false;
      return;
  }

  // 1. Check if we have a pending processing file from a previous failed attempt
  if (foundProcessing) {
      File file = LittleFS.open("/processing.txt", FILE_READ);
      if (file) {
          Serial.println("Retrying Offline Data Upload...");
          bool allSent = true;
          while (file.available()) {
              String line = file.readStringUntil('\n');
              line.trim();
              if (line.length() > 0) {
                  if (!client.connected() || !client.publish("greenhouse/data", line.c_str())) {
                      allSent = false;
                      break;
                  }
                  delay(50);
              }
          }
          file.close();
          if (allSent) {
              LittleFS.remove("/processing.txt");
              Serial.println("Old Offline Data Cleared");
          } else {
              return; // Stop if we failed again
          }
      }
  }

  // 2. Check for new offline data
  if (foundLog) {
      LittleFS.rename("/offline_log.txt", "/processing.txt");
      // Recursive call to process the newly renamed file
      processOfflineData();
  }
}

// --- TASK 4: CLOUD CONNECTIVITY ---
void configModeCallback (WiFiManager *myWiFiManager) {
  Serial.println("Entered config mode");
  portalRunning = true;
}

void TaskConnectivity(void *pvParameters) {
  WiFiManager wm;
  wm.setAPCallback(configModeCallback);
  wm.setConfigPortalTimeout(180); // 3 minutes timeout

  // 1. Initial Connection (Blocking, but updates portalRunning via callback)
  // This allows TaskInterface to show "WiFi Setup Mode" on LCD while this task blocks.
  if(!wm.autoConnect("Greenhouse-Setup")) {
      Serial.println("Failed to connect");
  } else {
      Serial.println("Connected!");
      wifiConnected = true;
  }
  portalRunning = false; 
  
  // Switch to non-blocking for runtime button triggers
  wm.setConfigPortalBlocking(false);

  // Initialize Blynk
  Blynk.config(BLYNK_AUTH_TOKEN);
  // Blynk.connect(); // Don't block here, let the loop handle it

  // Load AWS Certificates
  net.setCACert(AWS_CERT_CA);
  net.setCertificate(AWS_CERT_CRT);
  net.setPrivateKey(AWS_CERT_PRIVATE);
  
  client.setServer(AWS_IOT_ENDPOINT, 8883);
  client.setCallback(messageHandler);

  esp_task_wdt_add(NULL); // Add to WDT

  for (;;) {
      esp_task_wdt_reset(); // Feed WDT
      wm.process(); // Process WiFiManager (Non-blocking)
      portalRunning = wm.getConfigPortalActive();

      if (reconfigureWiFi) {
          Serial.println("Starting Config Portal (Non-Blocking)...");
          wm.startConfigPortal("Greenhouse-Setup");
          reconfigureWiFi = false;
      }

      if (stopPortalRequest) {
          Serial.println("Stopping Config Portal...");
          wm.stopConfigPortal();
          stopPortalRequest = false;
          vTaskDelay(100 / portTICK_PERIOD_MS); // Allow stack to settle
      }

      // Run Cloud tasks if WiFi is Connected (Even if Portal is running)
      if (WiFi.status() == WL_CONNECTED) {
          wifiConnected = true;
          
          // Ensure Blynk is connected (Non-blocking retry)
          static unsigned long lastBlynkAttempt = 0;
          if (!Blynk.connected()) {
             // Only try to connect every 15 seconds to avoid blocking the loop
             if (millis() - lastBlynkAttempt > 15000) {
                 lastBlynkAttempt = millis();
                 // Try to connect with a short timeout (2s)
                 Blynk.connect(2000); 
             }
          }
          
          // Run Blynk (Only if connected to avoid internal blocking retries)
          if (Blynk.connected()) {
             Blynk.run();
          }
          
          // Update Blynk with sensor data (every 2 seconds)
          static unsigned long lastBlynkUpdate = 0;
          if (millis() - lastBlynkUpdate > 2000) {
            // Send sensor readings to Blynk app
            if (Blynk.connected()) {
                Blynk.virtualWrite(VPIN_TEMP, currentTemp);
                Blynk.virtualWrite(VPIN_HUM, currentHum);
                Blynk.virtualWrite(VPIN_SOIL, soilMoisture);
                Blynk.virtualWrite(VPIN_CO2, eco2);
                Blynk.virtualWrite(VPIN_TANK_LEVEL, waterTankLevel);
                
                // Send device status LEDs
                Blynk.virtualWrite(VPIN_PUMP_LED, pumpStatus ? 255 : 0);
                Blynk.virtualWrite(VPIN_FAN_LED, fanStatus ? 255 : 0);
                Blynk.virtualWrite(VPIN_HEATER_LED, heaterStatus ? 255 : 0);
            }
            lastBlynkUpdate = millis();
          }
          
          // NTP Time Sync (Required for AWS SSL)
          time_t now = time(nullptr);
          if (now < 8 * 3600 * 2) { 
            configTime(0, 0, "pool.ntp.org", "time.nist.gov"); 
          }
          
          if (!client.connected()) {
              awsConnected = false;
              // Only try to connect to AWS occasionally to avoid spamming logs/blocking
              static unsigned long lastAwsAttempt = 0;
              if (millis() - lastAwsAttempt > 5000) {
                  lastAwsAttempt = millis();
                  Serial.print("AWS Connecting...");
                  if (client.connect("GreenHouse_Unit")) {
                      Serial.println("CONNECTED");
                      client.subscribe("greenhouse/commands");
                      awsConnected = true;
                  } else {
                      Serial.print("Failed: "); Serial.println(client.state());
                  }
              }
          } else {
              awsConnected = true;
              client.loop();
          }
      } else {
          // WiFi Lost
          if (!portalRunning) {
             wifiConnected = false;
             awsConnected = false;
          }
      }

      // Unified Data Logging & Publishing (Runs regardless of WiFi)
      static unsigned long lastDataGen = 0;
      if (millis() - lastDataGen > 5000) {
          char jsonBuffer[400]; 
          snprintf(jsonBuffer, sizeof(jsonBuffer), 
            "{\"device_id\": \"GreenHouse_Unit\", \"timestamp\": %lu, \"temp\": %.1f, \"hum\": %.1f, \"soil\": %d, \"co2\": %d, \"tvoc\": %d, \"tank_level\": %d, \"pump\": %d, \"fan\": %d, \"heater\": %d, \"mode\": \"%s\"}", 
            (unsigned long)time(nullptr),
            currentTemp, currentHum, soilMoisture, eco2, tvoc, waterTankLevel,
            pumpStatus ? 1 : 0, fanStatus ? 1 : 0, heaterStatus ? 1 : 0,
            manualMode ? "MANUAL" : "AUTO");

          if (wifiConnected && awsConnected) {
              client.publish("greenhouse/data", jsonBuffer);
              Serial.println("Published Data");
              
              // Also check for offline data upload here
              processOfflineData(); 
          } else {
              // If AWS is down (even if WiFi is up), log locally
              logDataOffline(jsonBuffer);
          }
          lastDataGen = millis();
      }

      vTaskDelay(50 / portTICK_PERIOD_MS); // Yield to other tasks
  }
}