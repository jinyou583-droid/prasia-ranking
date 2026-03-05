import os
import json
from openpyxl import load_workbook

UPLOAD_DIR = "uploads"
OUTPUT_DIR = "snapshots"

os.makedirs(OUTPUT_DIR, exist_ok=True)

for file in os.listdir(UPLOAD_DIR):
    if file.endswith(".xlsx"):

        path = os.path.join(UPLOAD_DIR, file)
        wb = load_workbook(path, data_only=True)

        if "통합정렬" not in wb.sheetnames:
            continue

        ws = wb["통합정렬"]

        rows = []
        for r in ws.iter_rows(min_row=2, values_only=True):
            if not r[0]:
                continue

            rows.append({
                "rank": r[0],
                "guild": r[1],
                "server": r[2],
                "hunt_score": r[3],
                "level_score": r[4],
                "total_score": r[5]
            })

        name = file.replace(".xlsx", ".json")

        with open(f"{OUTPUT_DIR}/{name}", "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=2)

print("Snapshots created")
