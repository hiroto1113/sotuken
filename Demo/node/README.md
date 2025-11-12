# Demo POWER SCAN Node Server

WebSocket server that accepts landmark JSON and returns combat power stats while logging to `power_scan_log.csv`.

## Message Schema
Send over WS:
```json
{
  "type": "landmarks",
  "width": 640,
  "height": 480,
  "landmarks": [ {"x":0.5,"y":0.4,"z":-0.02,"visibility":0.9}, ... ]
}
```
Response example:
```json
{
  "combat_stats": {
    "base_power": 123456,
    "pose_bonus": 0,
    "expression_bonus": 0,
    "speed_bonus": 0,
    "total_power": 123456
  },
  "received": 33
}
```

## CSV Format
`timestamp,base_power,pose_bonus,expression_bonus,speed_bonus,total_power,landmark_count`

## Run
```bash
npm install
npm start
```

Ensure client-side uses MediaPipe Holistic JS to produce landmark arrays.
