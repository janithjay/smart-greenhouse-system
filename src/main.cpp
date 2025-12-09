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

// --- HARDWARE CONFIGURATION ---
LiquidCrystal_I2C lcd(0x27, 16, 4);

// Sensor Objects
Adafruit_AHTX0 aht;
ScioSense_ENS160 ens160(ENS160_I2CADDR_1);

// AWS Objects
WiFiClientSecure net;
PubSubClient client(net);

// --- GLOBAL SHARED VARIABLES ---
// Volatile because they are shared between FreeRTOS tasks
volatile float currentTemp = 0.0;
volatile float currentHum = 0.0;
volatile int eco2 = 400; // Default CO2 baseline
volatile int tvoc = 0;
volatile int soilMoisture = 0;
volatile bool pumpStatus = false;
volatile bool wifiConnected = false;

// --- TASK HANDLES ---
void TaskReadSensors(void *pvParameters);
void TaskControlSystem(void *pvParameters);
void TaskConnectivity(void *pvParameters);
void TaskInterface(void *pvParameters);

// --- AWS CALLBACK ---
void messageHandler(char* topic, byte* payload, unsigned int length) {
  Serial.print("Incoming: ");
  Serial.println(topic);
}

void setup() {
  Serial.begin(115200);

  // 1. EXTEND WATCHDOG (Prevents reboot during SSL connection)
  esp_task_wdt_init(30, true); 
  
  // 2. Hardware Init
  Wire.begin(21, 22); // SDA=21, SCL=22
  
  // LCD Init
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0); lcd.print("Booting System...");

  // Sensors Init
  bool sensorsOK = true;
  
  if (!aht.begin()) {
    Serial.println("AHT21 Error!");
    lcd.setCursor(0, 1); lcd.print("AHT21 Failed");
    sensorsOK = false;
  } else {
    Serial.println("AHT21 Found");
  }

  if (!ens160.begin()) {
    Serial.println("ENS160 Error!");
  } else {
    Serial.println("ENS160 Found");
    ens160.setMode(ENS160_OPMODE_STD);
  }

  if(sensorsOK) {
      lcd.setCursor(0, 1); lcd.print("Sensors OK    ");
  }
  delay(1000);

  // 3. Create Tasks
  // Core 1: Sensors, Control, UI
  xTaskCreatePinnedToCore(TaskReadSensors, "Sensors", 4096, NULL, 1, NULL, 1);
  xTaskCreatePinnedToCore(TaskControlSystem, "Control", 4096, NULL, 2, NULL, 1);
  xTaskCreatePinnedToCore(TaskInterface, "UI", 4096, NULL, 1, NULL, 1);
  
  // Core 0: Connectivity (WiFi/AWS)
  xTaskCreatePinnedToCore(TaskConnectivity, "AWS", 10240, NULL, 1, NULL, 0);
}

void loop() {
  vTaskDelete(NULL); // Kill Arduino Loop
}

// --- TASK 1: READ REAL SENSORS ---
void TaskReadSensors(void *pvParameters) {
  for (;;) {
    // A. Read AHT21 (Temp & Humidity)
    sensors_event_t humidity, temp;
    aht.getEvent(&humidity, &temp); 
    currentTemp = temp.temperature;
    currentHum = humidity.relative_humidity;
    
    // B. Read ENS160 (Air Quality)
    if (ens160.available()) {
      ens160.measure(true);
      ens160.measureRaw(true);
      eco2 = ens160.geteCO2();
      tvoc = ens160.getTVOC();
    }

    // C. Read Soil Moisture (Analog)
    // 255 = Completely Dry (Air), 0 = Completely Wet (Water)
    int rawADC = analogRead(35); 
    soilMoisture = map(rawADC, 255, 0, 0, 100); 
    
    // Constrain to 0-100%
    if (soilMoisture < 0) soilMoisture = 0;
    if (soilMoisture > 100) soilMoisture = 100;

    vTaskDelay(2000 / portTICK_PERIOD_MS); // Read every 2 seconds
  }
}

// --- TASK 2: CONTROL SYSTEM (The Brains) ---
void TaskControlSystem(void *pvParameters) {
  pinMode(26, OUTPUT); // Water Pump Relay
  pinMode(5, OUTPUT);  // Ultrasonic Trig
  pinMode(34, INPUT);  // Ultrasonic Echo
  
  for (;;) {
    // 1. Measure Water Tank Level (Ultrasonic)
    digitalWrite(5, LOW); delayMicroseconds(2);
    digitalWrite(5, HIGH); delayMicroseconds(10);
    digitalWrite(5, LOW);
    long duration = pulseIn(34, HIGH);
    int distanceCM = duration * 0.034 / 2;

    // 2. Decision Logic
    // Logic: If Soil is DRY (< 30%) AND Tank has WATER (> 5cm depth)
    // Note: Ultrasonic distance increases as tank empties. 
    // Sensor at top: Large distance = Empty. Small distance = Full.
    // Tank Depth is 30cm. So > 25cm means empty.
    
    bool tankHasWater = (distanceCM < 25); 

    if (soilMoisture < 30) { 
      if (tankHasWater) { 
         digitalWrite(26, HIGH); // Pump ON
         pumpStatus = true;
      } else {
         digitalWrite(26, LOW); // Pump OFF (Safety Cutoff)
         pumpStatus = false;
      }
    } else {
       digitalWrite(26, LOW); // Soil is wet enough
       pumpStatus = false;
    }
    
    vTaskDelay(1000 / portTICK_PERIOD_MS);
  }
}

// --- TASK 3: USER INTERFACE (LCD) ---
void TaskInterface(void *pvParameters) {
  for (;;) {
    // Row 0: Temp & Hum
    lcd.setCursor(0, 0);
    lcd.print("T:"); lcd.print(currentTemp, 1); lcd.print("C H:"); lcd.print((int)currentHum); lcd.print("%");
    
    // Row 1: Soil & Pump
    lcd.setCursor(0, 1);
    lcd.print("Soil:"); lcd.print(soilMoisture); lcd.print("% P:"); 
    lcd.print(pumpStatus ? "ON " : "OFF");

    // Row 2: Air Quality
    lcd.setCursor(0, 2);
    lcd.print("CO2:"); lcd.print(eco2); lcd.print(" TVOC:"); lcd.print(tvoc);

    // Row 3: Network Status
    lcd.setCursor(0, 3);
    if(wifiConnected) lcd.print("AWS: CONNECTED  "); 
    else lcd.print("AWS: CONNECTING ");

    vTaskDelay(500 / portTICK_PERIOD_MS); 
  }
}

// --- TASK 4: CONNECTIVITY (WiFi + AWS + Time Sync) ---
void TaskConnectivity(void *pvParameters) {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  // Configure AWS Security
  net.setCACert(AWS_CERT_CA);
  net.setCertificate(AWS_CERT_CRT);
  net.setPrivateKey(AWS_CERT_PRIVATE);
  client.setServer(AWS_IOT_ENDPOINT, 8883);
  client.setCallback(messageHandler);

  for (;;) {
    if (WiFi.status() == WL_CONNECTED) {
      wifiConnected = true;
      
      // --- TIME SYNC (Required for AWS) ---
      time_t now = time(nullptr);
      if (now < 8 * 3600 * 2) { 
        configTime(0, 0, "pool.ntp.org", "time.nist.gov"); 
        delay(500);
      }

      // --- AWS CONNECTION ---
      if (!client.connected()) {
        Serial.print("Connecting to AWS...");
        vTaskDelay(100 / portTICK_PERIOD_MS); // Yield before heavy task
        
        if (client.connect("ESP32_Greenhouse_Client")) {
          Serial.println("CONNECTED!");
          client.subscribe("greenhouse/commands");
        } else {
          Serial.print("Failed. Error: ");
          Serial.println(client.state());
          vTaskDelay(5000 / portTICK_PERIOD_MS); 
        }
      } else {
        client.loop(); 
        
        // Publish Data Every 5 Seconds
        static unsigned long lastPub = 0;
        if (millis() - lastPub > 5000) {
           char jsonBuffer[150]; // Increased buffer size for extra data
           snprintf(jsonBuffer, sizeof(jsonBuffer), 
             "{\"temp\": %.1f, \"hum\": %.1f, \"soil\": %d, \"co2\": %d, \"pump\": \"%s\"}", 
             currentTemp, currentHum, soilMoisture, eco2, pumpStatus ? "ON" : "OFF");
             
           client.publish("greenhouse/data", jsonBuffer);
           Serial.println(jsonBuffer);
           lastPub = millis();
        }
      }
    } else {
      wifiConnected = false;
      Serial.println("WiFi Lost. Waiting...");
    }
    vTaskDelay(200 / portTICK_PERIOD_MS); 
  }
}