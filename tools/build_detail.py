import json
import re
from pathlib import Path
from openpyxl import load_workbook
import urllib.parse

UPLOAD_DIR = Path("uploads")
OUT_ROOT = Path("site") / "snapshots"

# 서버 시트에서 찾을 컬럼명(헤더)
NEED_COLS = {
    "guild": ["결사명", "결사"],
    "clazz": ["클래스", "직업"],
    "grade": ["토벌등급", "등급"],
}

def guess_date_key_from_stem(stem: str) -> str:
    # ranking_2026_03_05 -> 2026_03_05
    m = re.search(r"(\d{4})[_-](\d{2})[_-](\d{2})", stem)
    if not m:
        return "unknown"
    return f"{m.group(1)}_{m.group(2)}_{m.group(3)}"

def norm(s) -> str:
    return str(s or "").strip().replace("\n", "").replace("\r", "").replace(" ", "")

def find_header_map(ws, header_row=1, max_cols=200):
    """
    헤더 1행에서 결사명/클래스/토벌등급 컬럼 위치 찾기
    """
    colmap = {}
    for c in range(1, max_cols + 1):
        v = ws.cell(row=header_row, column=c).value
        if v is None:
            continue
        key = norm(v)

        for k, candidates in NEED_COLS.items():
            if key in [norm(x) for x in candidates]:
                colmap[k] = c

    return colmap

def is_server_sheet(ws) -> bool:
    hm = find_header_map(ws)
    return all(k in hm for k in ("guild", "clazz", "grade"))

def safe_int(x):
    try:
        if x is None or str(x).strip() == "":
            return None
        return int(float(x))
    except Exception:
        return None

def build_detail_for_xlsx(xlsx_path: Path):
    stem = xlsx_path.stem
    date_key = guess_date_key_from_stem(stem)
    out_dir = OUT_ROOT / f"detail_{date_key}"
    out_dir.mkdir(parents=True, exist_ok=True)

    wb = load_workbook(xlsx_path, data_only=True)

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        if not is_server_sheet(ws):
            continue

        hm = find_header_map(ws)
        gcol, ccol, grcol = hm["guild"], hm["clazz"], hm["grade"]

        guilds = {}

        # 데이터는 2행부터라고 가정
        for r in range(2, ws.max_row + 1):
            guild = ws.cell(row=r, column=gcol).value
            clazz = ws.cell(row=r, column=ccol).value
            grade = ws.cell(row=r, column=grcol).value

            guild = str(guild or "").strip()
            clazz = str(clazz or "").strip()
            grade_i = safe_int(grade)

            if guild == "":
                continue

            if guild not in guilds:
                guilds[guild] = {"members": 0, "byClass": {}, "byGrade": {}}

            guilds[guild]["members"] += 1

            if clazz != "":
                guilds[guild]["byClass"][clazz] = guilds[guild]["byClass"].get(clazz, 0) + 1

            if grade_i is not None:
                k = str(grade_i)
                guilds[guild]["byGrade"][k] = guilds[guild]["byGrade"].get(k, 0) + 1

        out = {
            "dateKey": date_key,
            "server": sheet_name,
            "guilds": guilds,
        }

        # ✅ 파일명은 서버명을 URL 인코딩해서 저장 (%EA%... 형태)
        fname = urllib.parse.quote(sheet_name, safe="") + ".json"
        out_path = out_dir / fname
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False)

def main():
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    xlsx_files = sorted(UPLOAD_DIR.glob("*.xlsx"))
    for xlsx in xlsx_files:
        build_detail_for_xlsx(xlsx)
    print("detail build done")

if __name__ == "__main__":
    main()
