import os
import json
from openpyxl import load_workbook

UPLOAD_DIR = "uploads"
OUTPUT_DIR = os.path.join("site", "snapshots")  # ✅ Pages에서 바로 읽게 site 아래로

os.makedirs(OUTPUT_DIR, exist_ok=True)

def to_int(x):
    """숫자/문자/None 섞여도 안전하게 int로 변환"""
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return int(x)
    s = str(x).strip()
    if s == "":
        return None
    # "1,234" 같은 케이스
    s = s.replace(",", "")
    try:
        return int(float(s))
    except:
        return None

def to_str(x):
    if x is None:
        return ""
    return str(x).strip()

# uploads 폴더에 있는 모든 xlsx 처리
for file in os.listdir(UPLOAD_DIR):
    if not file.lower().endswith(".xlsx"):
        continue

    path = os.path.join(UPLOAD_DIR, file)
    wb = load_workbook(path, data_only=True)

    # ✅ 시트 우선순위: "통합랭킹" 있으면 그걸, 없으면 첫 시트
    if "통합랭킹" in wb.sheetnames:
        ws = wb["통합랭킹"]
    else:
        ws = wb[wb.sheetnames[0]]

    rows = []
    # ✅ 2행부터 읽기 (1행이 헤더라고 가정)
    for r in ws.iter_rows(min_row=2, values_only=True):
        if not r:
            continue

        # ✅ 길이 부족하면 6칸까지 채움 (r[0]~r[5] 안전)
        r = list(r)
        if len(r) < 6:
            r += [None] * (6 - len(r))

        rank = to_int(r[0])
        guild = to_str(r[1])
        server = to_str(r[2])

        # ✅ 필수값 없으면 스킵 (빈 줄/중간 구분줄 같은 것)
        if rank is None and guild == "" and server == "":
            continue

        item = {
            "rank": rank,
            "guild": guild,
            "server": server,
            "hunt_score": to_int(r[3]),
            "level_score": to_int(r[4]),
            "total_score": to_int(r[5]),
        }
        rows.append(item)

    out_name = file[:-5] + ".json"  # .xlsx 제거
    out_path = os.path.join(OUTPUT_DIR, out_name)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)

    print(f"✅ wrote {out_path} ({len(rows)} rows)")

print("✅ Snapshots created")
