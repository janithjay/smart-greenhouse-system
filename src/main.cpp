#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <LiquidCrystal_I2C.h>
#include <esp_task_wdt.h>
#include <Adafruit_AHTX0.h>
#include <ScioSense_ENS160.h>
#include "secrets.h" 

// ==========================================
// 1. CONFIGURATION & PINOUT
// ==========================================

// --- SCOTCH BONNET PARAMETERS ---
// Welimada nights are cold (<18°C). Peppers stunt below 20°C.
#define TEMP_MIN_NIGHT  20.0  // Heater ON below this
#define TEMP_MAX_DAY    30.0  // Fan ON above this
#define HUM_MAX         75.0  // Fan ON above this (Prevent Fungal/Botrytis)
#define SOIL_DRY        40    // Pump ON below this % (irrigate)
#define SOIL_WET        70    // Pump OFF above this % (prevent root rot)

// --- SENSOR CALIBRATION (ESP32 is 12-bit: 0-4095) ---
// Need to calibrate for your specific soil sensor
const int AIR_VAL = 3200;    
const int WATER_VAL = 1400; 

// --- PIN DEFINITIONS ---
#define PIN_PUMP        26  // Water Pump Relay
#define PIN_FAN         27  // Exhaust Fan Relay
#define PIN_HEATER      14  // Heater / Halogen Lamp Relay
#define PIN_TRIG        5   // Ultrasonic Trig
#define PIN_ECHO        34  // Ultrasonic Echo
#define PIN_SOIL        35  // Soil Moisture Analog

// ==========================================
// 2. OBJECTS & VARIABLES
// ==========================================

LiquidCrystal_I2C lcd(0x27, 16, 4);
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

// --- TASK HANDLES ---
void TaskReadSensors(void *pvParameters);
void TaskControlSystem(void *pvParameters);
void TaskConnectivity(void *pvParameters);
void TaskInterface(void *pvParameters);

// --- AWS CALLBACK ---
void messageHandler(char* topic, byte* payload, unsigned int length) {
  //  Add logic here if want to control pump via AWS
  Serial.print("AWS CMD: "); Serial.println(topic);
}

// ==========================================
// 3. SETUP
// ==========================================
void setup() {
  Serial.begin(115200);
  
  // Initialize Watchdog (30s timeout)
  esp_task_wdt_init(30, true); 

  // Initialize I2C
  Wire.begin(21, 22);

  // Initialize Relays (Assuming Active HIGH)
  pinMode(PIN_PUMP, OUTPUT); digitalWrite(PIN_PUMP, LOW);
  pinMode(PIN_FAN, OUTPUT); digitalWrite(PIN_FAN, LOW);
  pinMode(PIN_HEATER, OUTPUT); digitalWrite(PIN_HEATER, LOW);

  // Initialize LCD
  lcd.init(); lcd.backlight();
  lcd.setCursor(0, 0); lcd.print("Smart GreenHouse");
  lcd.setCursor(0, 1); lcd.print("System Start...");

  // Initialize Sensors
  bool sensorsOk = true;
  if (!aht.begin()) { Serial.println("AHT Error"); sensorsOk = false; }
  if (!ens160.begin()) { Serial.println("ENS Error"); sensorsOk = false; }
  else ens160.setMode(ENS160_OPMODE_STD);

  if(!sensorsOk) {
    lcd.setCursor(0, 1); lcd.print("Sensor Failure!");
    delay(2000);
  }

  // Create RTOS Tasks
  // Core 1 (Application Logic)
  xTaskCreatePinnedToCore(TaskReadSensors, "Sensors", 4096, NULL, 1, NULL, 1);
  xTaskCreatePinnedToCore(TaskControlSystem, "Control", 4096, NULL, 2, NULL, 1);
  xTaskCreatePinnedToCore(TaskInterface, "UI", 4096, NULL, 1, NULL, 1);
  
  // Core 0 (WiFi/SSL/Radio)
  xTaskCreatePinnedToCore(TaskConnectivity, "AWS", 10240, NULL, 1, NULL, 0);
}

void loop() {
  vTaskDelete(NULL); // Everything runs in tasks
}

// ==========================================
// 4. TASKS
// ==========================================

// --- TASK 1: SENSOR READING ---
void TaskReadSensors(void *pvParameters) {
  for (;;) {
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
    // If your sensor logic is reversed, swap 0 and 100 below
    soilMoisture = map(rawADC, AIR_VAL, WATER_VAL, 0, 100); 
    
    vTaskDelay(2000 / portTICK_PERIOD_MS); 
  }
}

// --- TASK 2: INTELLIGENT CONTROL ---
void TaskControlSystem(void *pvParameters) {
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  
  for (;;) {
    // 1. Water Tank Level Check
    digitalWrite(PIN_TRIG, LOW); delayMicroseconds(2);
    digitalWrite(PIN_TRIG, HIGH); delayMicroseconds(10);
    digitalWrite(PIN_TRIG, LOW);
    long duration = pulseIn(PIN_ECHO, HIGH);
    int distanceCM = duration * 0.034 / 2;
    // Tank is empty if distance > 25cm (sensor at top looking down)
    bool tankHasWater = (distanceCM < 25); 

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
    
    vTaskDelay(1000 / portTICK_PERIOD_MS);
  }
}

// --- TASK 3: USER INTERFACE ---
void TaskInterface(void *pvParameters) {
  for (;;) {
    // Line 0: Temp & Heater Status
    lcd.setCursor(0, 0);
    lcd.printf("T:%.1f H:%s ", currentTemp, heaterStatus ? "ON" : "OFF");
    lcd.print("Hu:"); lcd.print((int)currentHum); lcd.print("%");
    
    // Line 1: Soil & Pump Status
    lcd.setCursor(0, 1);
    lcd.printf("Soil:%d%%     P:%s", soilMoisture, pumpStatus ? "ON   " : "OFF");

    // Line 2: Air Quality
    lcd.setCursor(0, 2);
    lcd.printf("CO2 :%d    FAN:%s", eco2, fanStatus ? "ON  " : "OFF");

    // Line 3: Connection
    lcd.setCursor(0, 3);
    lcd.print(wifiConnected ? "AWS :ONLINE        " : "AWS :CONNECTING");

    vTaskDelay(500 / portTICK_PERIOD_MS); 
  }
}

// --- TASK 4: CLOUD CONNECTIVITY ---
void TaskConnectivity(void *pvParameters) {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  // Load Certificates
  net.setCACert(AWS_CERT_CA);
  net.setCertificate(AWS_CERT_CRT);
  net.setPrivateKey(AWS_CERT_PRIVATE);
  
  client.setServer(AWS_IOT_ENDPOINT, 8883);
  client.setCallback(messageHandler);

  for (;;) {
      if (WiFi.status() == WL_CONNECTED) {
          wifiConnected = true;
          
          // NTP Time Sync (Required for AWS SSL)
          time_t now = time(nullptr);
          if (now < 8 * 3600 * 2) { 
            configTime(0, 0, "pool.ntp.org", "time.nist.gov"); 
            delay(1000);
          }
          
          if (!client.connected()) {
              Serial.print("AWS Connecting...");
              if (client.connect("GreenHouse_Unit")) {
                  Serial.println("CONNECTED");
                  client.subscribe("greenhouse/commands");
              } else {
                  Serial.print("Failed: "); Serial.println(client.state());
                  vTaskDelay(5000 / portTICK_PERIOD_MS);
              }
          } else {
              client.loop();
              
              // Non-blocking publish timer
              static unsigned long lastPub = 0;
              if (millis() - lastPub > 5000) {
                  char jsonBuffer[256]; 
                  snprintf(jsonBuffer, sizeof(jsonBuffer), 
                    "{\"temp\": %.1f, \"hum\": %.1f, \"soil\": %d, \"co2\": %d, \"pump\": \"%s\", \"fan\": \"%s\", \"heater\": \"%s\"}", 
                    currentTemp, currentHum, soilMoisture, eco2, 
                    pumpStatus ? "ON" : "OFF", fanStatus ? "ON" : "OFF", heaterStatus ? "ON" : "OFF");
                  
                  client.publish("greenhouse/data", jsonBuffer);
                  Serial.println("Published Data");
                  lastPub = millis();
              }
          }
      } else {
          wifiConnected = false;
          Serial.println("WiFi Lost");
      }
      vTaskDelay(200 / portTICK_PERIOD_MS);
  }
}