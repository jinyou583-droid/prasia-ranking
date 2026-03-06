import json
import shutil
from datetime import datetime
from pathlib import Path
from collections import defaultdict
from urllib.parse import quote

from openpyxl import load_workbook

UPLOAD_DIR = Path("uploads")
OUT_DIR = Path("site") / "snapshots"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# 결사 랭킹 시트 우선순위
PREFERRED_SHEETS = ["통합정렬", "통합 정렬", "결사랭킹", "결사 랭킹"]

# 전체 통계 시트 후보
LEVEL_STAT_SHEETS = ["레벨별통계", "레벨별 통계"]
HUNT_STAT_SHEETS = ["토벌등급별통계", "토벌등급별 통계"]

# 캐릭터 상세 목록 시트 후보
MEMBER_DETAIL_SHEETS = ["토벌상위분류"]


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
    parts = stem.replace("-", "_").split("_")
    nums = [p for p in parts if p.isdigit()]
    if len(nums) >= 3:
        y, m, d = nums[-3], nums[-2], nums[-1]
        if len(y) == 4:
            return f"{y}-{m.zfill(2)}-{d.zfill(2)}"
    return stem


def guess_date_key_from_filename(stem: str) -> str:
    parts = stem.replace("-", "_").split("_")
    nums = [p for p in parts if p.isdigit()]
    if len(nums) >= 3:
        y, m, d = nums[-3], nums[-2], nums[-1]
        if len(y) == 4:
            return f"{y}_{m.zfill(2)}_{d.zfill(2)}"
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
    """
    통합정렬 시트 헤더 찾기
    """
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
        elif key in ("총점", "총점수", "총점수합계", "총점수(합계)", "총점수합계"):
            m["total_score"] = col
        elif key in (
            "토벌등급점수",
            "토벌등급합계",
            "토벌등급점수합계",
            "토벌등급점수(합계)",
            "토벌등급합계점수",
            "토벌등급합계",
        ):
            m["hunt_score"] = col
        elif key in (
            "레벨별점수",
            "레벨별합계",
            "레벨별점수합계",
            "레벨별점수(합계)",
            "레벨별합계점수",
            "레벨별점수합계",
        ):
            m["level_score"] = col

    return m


def find_server_sheet_header_map(ws, header_row=1, max_cols=200):
    """
    서버별 시트에서 필요한 컬럼 찾기
    """
    colmap = {}
    for c in range(1, max_cols + 1):
        v = ws.cell(row=header_row, column=c).value
        if v is None:
            continue
        key = normalize_header(v)

        if key in ("닉네임", "캐릭터명", "이름", "명칭"):
            colmap["nickname"] = c
        elif key in ("결사명", "결사"):
            colmap["guild"] = c
        elif key in ("클래스", "직업"):
            colmap["clazz"] = c
        elif key in ("토벌등급", "등급"):
            colmap["grade"] = c
        elif key in ("레벨", "Lv", "LV"):
            colmap["level"] = c

    return colmap


def is_server_sheet(ws) -> bool:
    hm = find_server_sheet_header_map(ws)
    return "guild" in hm


def build_member_count_map(wb):
    """
    각 서버 시트에서 결사별 총원 집계
    key: (guild, serverSheetName)
    value: members
    """
    member_map = {}

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]

        if sheet_name in PREFERRED_SHEETS:
            continue
        if sheet_name in LEVEL_STAT_SHEETS:
            continue
        if sheet_name in HUNT_STAT_SHEETS:
            continue
        if sheet_name in MEMBER_DETAIL_SHEETS:
            continue

        if not is_server_sheet(ws):
            continue

        hm = find_server_sheet_header_map(ws)
        gcol = hm["guild"]

        for r in range(2, ws.max_row + 1):
            guild = safe_str(ws.cell(row=r, column=gcol).value)

            if guild == "":
                continue
            if guild.replace(" ", "") == "-":
                continue

            key = (guild, sheet_name)
            member_map[key] = member_map.get(key, 0) + 1

    return member_map


def parse_guild_ranking(ws, member_map=None):
    header = build_header_map(ws, header_row=1)

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

        if rank is None and guild_str == "" and server_str == "":
            continue

        if guild_str.replace(" ", "") == "-":
            continue

        hunt_score = ws.cell(row=r, column=hunt_col).value
        level_score = ws.cell(row=r, column=level_col).value
        total_score = ws.cell(row=r, column=total_col).value

        members = 0
        if member_map is not None:
            members = member_map.get((guild_str, server_str), 0)

        rows.append({
            "rank": safe_num(rank),
            "guild": guild_str,
            "server": server_str,
            "members": members,
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

    def sort_key(x):
        v = x.get(key_name)
        try:
            return -int(str(v))
        except Exception:
            return 999999

    rows.sort(key=sort_key)
    return rows


def parse_member_detail_sheet(ws):
    """
    토벌상위분류 시트 구조:
    A: 닉네임
    B: 결사명
    C: 클래스
    D: 토벌등급
    E: 레벨
    F: 서버명

    단, 서버명이 '통합정렬' 인 행은 제외
    """
    level_members = defaultdict(list)
    grade_members = defaultdict(list)

    for r in range(2, ws.max_row + 1):
        nickname = safe_str(ws.cell(row=r, column=1).value)
        guild = safe_str(ws.cell(row=r, column=2).value)
        clazz = safe_str(ws.cell(row=r, column=3).value)
        grade = safe_num(ws.cell(row=r, column=4).value)
        level = safe_num(ws.cell(row=r, column=5).value)
        server = safe_str(ws.cell(row=r, column=6).value)

        if nickname == "" and guild == "" and server == "":
            continue

        if server == "통합정렬":
            continue

        row = {
            "nickname": nickname,
            "guild": guild,
            "class": clazz,
            "grade": grade if grade is not None else 0,
            "level": level if level is not None else 0,
            "server": server,
        }

        level_key = str(int(level)) if isinstance(level, (int, float)) else safe_str(level)
        grade_key = str(int(grade)) if isinstance(grade, (int, float)) else safe_str(grade)

        if level_key:
            level_members[level_key].append(row)
        if grade_key:
            grade_members[grade_key].append(row)

    def sort_member_rows(rows):
        return sorted(
            rows,
            key=lambda x: (
                -int(x.get("grade", 0) or 0),
                -int(x.get("level", 0) or 0),
                safe_str(x.get("guild", "")),
                safe_str(x.get("nickname", "")),
            )
        )

    level_members = {k: sort_member_rows(v) for k, v in level_members.items()}
    grade_members = {k: sort_member_rows(v) for k, v in grade_members.items()}

    return {
        "levelMembers": level_members,
        "huntGradeMembers": grade_members,
    }


def build_server_detail_data(wb):
    """
    결사 상세 팝업용 detail 데이터를 생성
    우선순위:
    1) 토벌상위분류 시트 사용 (닉네임/결사/직업/등급/레벨/서버가 모두 있음)
    2) 없으면 서버 시트 fallback
    """
    ws_member, _ = pick_sheet_by_candidates(wb, MEMBER_DETAIL_SHEETS)

    # 1) 토벌상위분류 시트가 있으면 이걸 기준으로 생성
    if ws_member:
        server_details = {}

        for r in range(2, ws_member.max_row + 1):
            nickname = safe_str(ws_member.cell(row=r, column=1).value)
            guild = safe_str(ws_member.cell(row=r, column=2).value)
            clazz = safe_str(ws_member.cell(row=r, column=3).value)
            grade = safe_num(ws_member.cell(row=r, column=4).value)
            level = safe_num(ws_member.cell(row=r, column=5).value)
            server = safe_str(ws_member.cell(row=r, column=6).value)

            if nickname == "" and guild == "" and server == "":
                continue

            if server == "통합정렬":
                continue

            if guild == "":
                continue
            if guild.replace(" ", "") == "-":
                continue
            if server == "":
                continue

            if server not in server_details:
                server_details[server] = {
                    "server": server,
                    "guilds": {}
                }

            guilds = server_details[server]["guilds"]

            if guild not in guilds:
                guilds[guild] = {
                    "members": 0,
                    "byClass": defaultdict(int),
                    "byGrade": defaultdict(int),
                    "membersList": [],
                    "byClassMembers": defaultdict(list),
                    "byGradeMembers": defaultdict(list),
                }

            member_row = {
                "nickname": nickname,
                "guild": guild,
                "class": clazz,
                "grade": grade if grade is not None else 0,
                "level": level if level is not None else 0,
                "server": server,
            }

            guilds[guild]["members"] += 1
            guilds[guild]["membersList"].append(member_row)

            if clazz != "":
                guilds[guild]["byClass"][clazz] += 1
                guilds[guild]["byClassMembers"][clazz].append(member_row)

            grade_key = str(int(grade)) if isinstance(grade, (int, float)) else safe_str(grade)
            if grade_key != "":
                guilds[guild]["byGrade"][grade_key] += 1
                guilds[guild]["byGradeMembers"][grade_key].append(member_row)

        # 정렬/딕셔너리 변환
        for server_name, server_data in server_details.items():
            for guild_name, g in server_data["guilds"].items():
                g["byClass"] = dict(sorted(g["byClass"].items(), key=lambda x: (-x[1], x[0])))

                def grade_sort_key(item):
                    k = item[0]
                    try:
                        return -int(str(k))
                    except Exception:
                        return 999999

                g["byGrade"] = dict(sorted(g["byGrade"].items(), key=grade_sort_key))

                g["membersList"] = sorted(
                    g["membersList"],
                    key=lambda x: (
                        -int(x.get("grade", 0) or 0),
                        -int(x.get("level", 0) or 0),
                        safe_str(x.get("nickname", "")),
                    )
                )

                g["byClassMembers"] = {
                    k: sorted(
                        v,
                        key=lambda x: (
                            -int(x.get("grade", 0) or 0),
                            -int(x.get("level", 0) or 0),
                            safe_str(x.get("nickname", "")),
                        )
                    )
                    for k, v in g["byClassMembers"].items()
                }

                g["byGradeMembers"] = {
                    k: sorted(
                        v,
                        key=lambda x: (
                            -int(x.get("grade", 0) or 0),
                            -int(x.get("level", 0) or 0),
                            safe_str(x.get("nickname", "")),
                        )
                    )
                    for k, v in g["byGradeMembers"].items()
                }

        return server_details

    # 2) fallback: 서버 시트 기반 생성
    server_details = {}

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]

        if sheet_name in PREFERRED_SHEETS:
            continue
        if sheet_name in LEVEL_STAT_SHEETS:
            continue
        if sheet_name in HUNT_STAT_SHEETS:
            continue
        if sheet_name in MEMBER_DETAIL_SHEETS:
            continue

        if not is_server_sheet(ws):
            continue

        hm = find_server_sheet_header_map(ws)
        gcol = hm.get("guild")
        ncol = hm.get("nickname")
        ccol = hm.get("clazz")
        grcol = hm.get("grade")
        lcol = hm.get("level")

        guilds = {}

        for r in range(2, ws.max_row + 1):
            guild = safe_str(ws.cell(row=r, column=gcol).value) if gcol else ""
            nickname = safe_str(ws.cell(row=r, column=ncol).value) if ncol else ""
            clazz = safe_str(ws.cell(row=r, column=ccol).value) if ccol else ""
            grade = safe_num(ws.cell(row=r, column=grcol).value) if grcol else 0
            level = safe_num(ws.cell(row=r, column=lcol).value) if lcol else 0

            if guild == "":
                continue
            if guild.replace(" ", "") == "-":
                continue

            if guild not in guilds:
                guilds[guild] = {
                    "members": 0,
                    "byClass": defaultdict(int),
                    "byGrade": defaultdict(int),
                    "membersList": [],
                    "byClassMembers": defaultdict(list),
                    "byGradeMembers": defaultdict(list),
                }

            member_row = {
                "nickname": nickname,
                "guild": guild,
                "class": clazz,
                "grade": grade if grade is not None else 0,
                "level": level if level is not None else 0,
                "server": sheet_name,
            }

            guilds[guild]["members"] += 1
            guilds[guild]["membersList"].append(member_row)

            if clazz != "":
                guilds[guild]["byClass"][clazz] += 1
                guilds[guild]["byClassMembers"][clazz].append(member_row)

            grade_key = str(int(grade)) if isinstance(grade, (int, float)) else safe_str(grade)
            if grade_key != "":
                guilds[guild]["byGrade"][grade_key] += 1
                guilds[guild]["byGradeMembers"][grade_key].append(member_row)

        for guild_name, g in guilds.items():
            g["byClass"] = dict(sorted(g["byClass"].items(), key=lambda x: (-x[1], x[0])))

            def grade_sort_key(item):
                k = item[0]
                try:
                    return -int(str(k))
                except Exception:
                    return 999999

            g["byGrade"] = dict(sorted(g["byGrade"].items(), key=grade_sort_key))

            g["membersList"] = sorted(
                g["membersList"],
                key=lambda x: (
                    -int(x.get("grade", 0) or 0),
                    -int(x.get("level", 0) or 0),
                    safe_str(x.get("nickname", "")),
                )
            )

            g["byClassMembers"] = {
                k: sorted(
                    v,
                    key=lambda x: (
                        -int(x.get("grade", 0) or 0),
                        -int(x.get("level", 0) or 0),
                        safe_str(x.get("nickname", "")),
                    )
                )
                for k, v in g["byClassMembers"].items()
            }

            g["byGradeMembers"] = {
                k: sorted(
                    v,
                    key=lambda x: (
                        -int(x.get("grade", 0) or 0),
                        -int(x.get("level", 0) or 0),
                        safe_str(x.get("nickname", "")),
                    )
                )
                for k, v in g["byGradeMembers"].items()
            }

        server_details[sheet_name] = {
            "server": sheet_name,
            "guilds": guilds,
        }

    return server_details


def build_snapshots_from_uploads():
    index = []

    xlsx_files = sorted(list(UPLOAD_DIR.glob("*.xlsx")) + list(UPLOAD_DIR.glob("*.xlsm")))
    for xlsx_path in xlsx_files:
        stem = xlsx_path.stem
        label = guess_label_from_filename(stem)
        date_key = guess_date_key_from_filename(stem)

        ranking_out_name = f"{stem}.json"
        ranking_out_path = OUT_DIR / ranking_out_name

        stats_out_name = f"stats_{stem}.json"
        stats_out_path = OUT_DIR / stats_out_name

        member_stats_out_name = f"stats_members_{stem}.json"
        member_stats_out_path = OUT_DIR / member_stats_out_name

        detail_dir = OUT_DIR / f"detail_{date_key}"

        wb = load_workbook(xlsx_path, data_only=True)

        member_map = build_member_count_map(wb)

        # 랭킹
        ws_rank, used_sheet = pick_worksheet(wb)
        ranking_data = parse_guild_ranking(ws_rank, member_map)

        with open(ranking_out_path, "w", encoding="utf-8") as f:
            json.dump(ranking_data, f, ensure_ascii=False, indent=2)

        # 전체 통계
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

        # 레벨/토벌등급별 캐릭터 목록
        ws_member, member_sheet_name = pick_sheet_by_candidates(wb, MEMBER_DETAIL_SHEETS)
        member_stats_data = {
            "label": label,
            "file": ranking_out_name,
            "memberSheet": member_sheet_name,
            "levelMembers": {},
            "huntGradeMembers": {},
        }

        if ws_member:
            parsed_member_stats = parse_member_detail_sheet(ws_member)
            member_stats_data["levelMembers"] = parsed_member_stats["levelMembers"]
            member_stats_data["huntGradeMembers"] = parsed_member_stats["huntGradeMembers"]

        with open(member_stats_out_path, "w", encoding="utf-8") as f:
            json.dump(member_stats_data, f, ensure_ascii=False, indent=2)

        # 서버별 결사 상세(detail_날짜/서버.json)
        if detail_dir.exists():
            shutil.rmtree(detail_dir)
        detail_dir.mkdir(parents=True, exist_ok=True)

                server_details = build_server_detail_data(wb)
        for server_name, detail_data in server_details.items():
            file_server_name = safe_str(server_name)
            out_path = detail_dir / f"{file_server_name}.json"
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(detail_data, f, ensure_ascii=False, indent=2)

        index.append({
            "label": label,
            "file": ranking_out_name,
            "statsFile": stats_out_name,
            "statsMembersFile": member_stats_out_name,
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
