import json
from datetime import datetime
from pathlib import Path

from openpyxl import load_workbook

UPLOAD_DIR = Path("uploads")
OUT_DIR = Path("site") / "snapshots"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ✅ 결사 랭킹 시트 우선순위
PREFERRED_SHEETS = ["통합정렬", "통합 정렬", "결사랭킹", "결사 랭킹"]

# ✅ 전체 통계 시트 후보
LEVEL_STAT_SHEETS = ["레벨별통계", "레벨별 통계"]
HUNT_STAT_SHEETS = ["토벌등급별통계", "토벌등급별 통계"]


def safe_str(x):
    if x is None:
        return ""
    return str(x).strip()


def safe_num(x):
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return x
    s = str(x).strip().replace(",", "")
    if s == "":
        return None
    try:
        if "." in s:
            return float(s)
        return int(s)
    except Exception:
        return s


def guess_label_from_filename(stem: str) -> str:
    # ranking_2026_03_05 -> 2026-03-05
    parts = stem.replace("-", "_").split("_")
    nums = [p for p in parts if p.isdigit()]
    if len(nums) >= 3:
        y, m, d = nums[-3], nums[-2], nums[-1]
        if len(y) == 4:
            return f"{y}-{m.zfill(2)}-{d.zfill(2)}"
    return stem


def pick_worksheet(wb):
    for name in PREFERRED_SHEETS:
        if name in wb.sheetnames:
            return wb[name], name
    return wb[wb.sheetnames[0]], wb.sheetnames[0]


def pick_sheet_by_candidates(wb, candidates):
    for name in candidates:
        if name in wb.sheetnames:
            return wb[name], name
    return None, None


def normalize_header(v):
    return safe_str(v).replace("\n", "").replace("\r", "").replace(" ", "")


def build_header_map(ws, header_row=1, max_cols=80):
    m = {}
    for col in range(1, max_cols + 1):
        v = ws.cell(row=header_row, column=col).value
        if v is None:
            continue
        key = normalize_header(v)

        if key in ("순위",):
            m["rank"] = col
        elif key in ("결사명", "결사"):
            m["guild"] = col
        elif key in ("서버명", "서버"):
            m["server"] = col
        elif key in ("총점", "총점수", "총점수합계", "총점수(합계)"):
            m["total_score"] = col
        elif key in ("토벌등급점수", "토벌등급합계", "토벌등급점수합계", "토벌등급점수(합계)", "토벌등급합계점수"):
            m["hunt_score"] = col
        elif key in ("레벨별점수", "레벨별합계", "레벨별점수합계", "레벨별점수(합계)", "레벨별합계점수"):
            m["level_score"] = col

    return m


def parse_guild_ranking(ws):
    header = build_header_map(ws, header_row=1)

    # fallback
    rank_col = header.get("rank", 1)
    guild_col = header.get("guild", 2)
    server_col = header.get("server", 3)
    hunt_col = header.get("hunt_score", 4)
    level_col = header.get("level_score", 5)
    total_col = header.get("total_score", 6)

    rows = []
    for r in range(2, ws.max_row + 1):
        rank = ws.cell(row=r, column=rank_col).value
        guild = ws.cell(row=r, column=guild_col).value
        server = ws.cell(row=r, column=server_col).value

        guild_str = safe_str(guild)
        server_str = safe_str(server)

        # 빈 줄 스킵
        if rank is None and guild_str == "" and server_str == "":
            continue

        # ✅ 결사명이 "-" 이면 제외
        if guild_str.replace(" ", "") == "-":
            continue

        hunt_score = ws.cell(row=r, column=hunt_col).value
        level_score = ws.cell(row=r, column=level_col).value
        total_score = ws.cell(row=r, column=total_col).value

        rows.append({
            "rank": safe_num(rank),
            "guild": guild_str,
            "server": server_str,
            "hunt_score": safe_num(hunt_score),
            "level_score": safe_num(level_score),
            "total_score": safe_num(total_score),
        })

    def sort_key(x):
        v = x.get("rank")
        if isinstance(v, (int, float)):
            return v
        try:
            return int(str(v))
        except Exception:
            return 10**9

    rows.sort(key=sort_key)

    # ✅ 제외된 행 때문에 비는 순위를 다시 1부터 재부여
    for i, row in enumerate(rows, start=1):
        row["rank"] = i

    return rows


def parse_stat_sheet(ws, key_name):
    """
    3열 구조 가정:
    A: 레벨 or 토벌등급
    B: 인원수
    C: 비율
    """
    rows = []

    for r in range(2, ws.max_row + 1):
        key_val = ws.cell(row=r, column=1).value
        count_val = ws.cell(row=r, column=2).value
        ratio_val = ws.cell(row=r, column=3).value

        if key_val is None and count_val is None and ratio_val is None:
            continue

        key_str = safe_str(key_val)
        count_num = safe_num(count_val)
        ratio_num = safe_num(ratio_val)

        if key_str == "" and count_num is None:
            continue

        rows.append({
            key_name: key_str,
            "count": count_num if count_num is not None else 0,
            "ratio": ratio_num if isinstance(ratio_num, (int, float)) else 0,
        })

    # 숫자 내림차순 정렬
    def sort_key(x):
        v = x.get(key_name)
        try:
            return -int(str(v))
        except Exception:
            return 999999

    rows.sort(key=sort_key)
    return rows


def build_snapshots_from_uploads():
    index = []

    xlsx_files = sorted(UPLOAD_DIR.glob("*.xlsx"))
    for xlsx_path in xlsx_files:
        stem = xlsx_path.stem
        label = guess_label_from_filename(stem)

        ranking_out_name = f"{stem}.json"
        ranking_out_path = OUT_DIR / ranking_out_name

        stats_out_name = f"stats_{stem}.json"
        stats_out_path = OUT_DIR / stats_out_name

        wb = load_workbook(xlsx_path, data_only=True)

        # ===== 랭킹 =====
        ws_rank, used_sheet = pick_worksheet(wb)
        ranking_data = parse_guild_ranking(ws_rank)

        with open(ranking_out_path, "w", encoding="utf-8") as f:
            json.dump(ranking_data, f, ensure_ascii=False, indent=2)

        # ===== 전체 통계 =====
        ws_level, level_sheet_name = pick_sheet_by_candidates(wb, LEVEL_STAT_SHEETS)
        ws_hunt, hunt_sheet_name = pick_sheet_by_candidates(wb, HUNT_STAT_SHEETS)

        stats_data = {
            "label": label,
            "file": ranking_out_name,
            "levelSheet": level_sheet_name,
            "huntSheet": hunt_sheet_name,
            "levelStats": parse_stat_sheet(ws_level, "level") if ws_level else [],
            "huntGradeStats": parse_stat_sheet(ws_hunt, "grade") if ws_hunt else [],
        }

        with open(stats_out_path, "w", encoding="utf-8") as f:
            json.dump(stats_data, f, ensure_ascii=False, indent=2)

        index.append({
            "label": label,
            "file": ranking_out_name,
            "statsFile": stats_out_name,
            "rows": len(ranking_data),
            "sheet": used_sheet,
        })

    def sort_key(item):
        try:
            return datetime.strptime(item["label"], "%Y-%m-%d")
        except Exception:
            return datetime.min

    index.sort(key=sort_key, reverse=True)

    with open(OUT_DIR / "index.json", "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    print(f"Generated {len(index)} snapshot(s) into {OUT_DIR}")


if __name__ == "__main__":
    build_snapshots_from_uploads()
