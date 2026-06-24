# Performance Baseline

## Pre-fix

```json
[
  {"combo":"no_filter","count":300,"errors":0,"p50_ms":400.11,"p95_ms":568.31,"p99_ms":633.0,"max_ms":808.86},
  {"combo":"status_only","count":300,"errors":0,"p50_ms":457.13,"p95_ms":531.42,"p99_ms":654.21,"max_ms":1057.48},
  {"combo":"date_range_only","count":300,"errors":0,"p50_ms":386.0,"p95_ms":553.14,"p99_ms":618.31,"max_ms":635.92},
  {"combo":"status_and_date_range","count":300,"errors":0,"p50_ms":407.74,"p95_ms":567.45,"p99_ms":661.86,"max_ms":810.99},
  {"combo":"assignee_only","count":300,"errors":0,"p50_ms":375.89,"p95_ms":522.11,"p99_ms":606.0,"max_ms":787.53},
  {"combo":"status_and_assignee","count":300,"errors":0,"p50_ms":461.98,"p95_ms":655.9,"p99_ms":664.15,"max_ms":1172.44},
  {"combo":"date_range_and_assignee","count":300,"errors":0,"p50_ms":427.2,"p95_ms":596.52,"p99_ms":728.87,"max_ms":772.04},
  {"combo":"all_filters","count":300,"errors":0,"p50_ms":386.67,"p95_ms":432.86,"p99_ms":749.35,"max_ms":756.01},
  {"combo":"burst_single_task[53d36f6f-0b84-4fdb-9614-94aa85011457]","count":100,"errors":0,"p50_ms":16.43,"p95_ms":18.66,"p99_ms":19.33,"max_ms":19.47}
]
```

## Post-fix

```json
[
  {
    "combo": "no_filter",
    "count": 200,
    "errors": 0,
    "p50_ms": 14.21,
    "p95_ms": 45.97,
    "p99_ms": 51.3,
    "max_ms": 51.78
  },
  {
    "combo": "status_only",
    "count": 200,
    "errors": 0,
    "p50_ms": 11.73,
    "p95_ms": 16.09,
    "p99_ms": 18.65,
    "max_ms": 19.29
  },
  {
    "combo": "date_range_only",
    "count": 200,
    "errors": 0,
    "p50_ms": 12.71,
    "p95_ms": 17.34,
    "p99_ms": 20.4,
    "max_ms": 21.13
  },
  {
    "combo": "status_and_date_range",
    "count": 200,
    "errors": 0,
    "p50_ms": 12.0,
    "p95_ms": 15.21,
    "p99_ms": 15.84,
    "max_ms": 16.4
  },
  {
    "combo": "assignee_only",
    "count": 200,
    "errors": 0,
    "p50_ms": 11.99,
    "p95_ms": 16.19,
    "p99_ms": 18.5,
    "max_ms": 18.68
  },
  {
    "combo": "status_and_assignee",
    "count": 200,
    "errors": 0,
    "p50_ms": 11.39,
    "p95_ms": 13.86,
    "p99_ms": 15.78,
    "max_ms": 16.51
  },
  {
    "combo": "date_range_and_assignee",
    "count": 200,
    "errors": 0,
    "p50_ms": 11.69,
    "p95_ms": 15.89,
    "p99_ms": 17.4,
    "max_ms": 18.8
  },
  {
    "combo": "all_filters",
    "count": 200,
    "errors": 0,
    "p50_ms": 12.4,
    "p95_ms": 16.75,
    "p99_ms": 17.66,
    "max_ms": 18.87
  },
  {
    "combo": "burst_single_task[5f7650d9-ed27-4f1b-92e2-2941adb2d4d7]",
    "count": 50,
    "errors": 0,
    "p50_ms": 7.07,
    "p95_ms": 10.06,
    "p99_ms": 11.62,
    "max_ms": 12.46
  }
]
```
