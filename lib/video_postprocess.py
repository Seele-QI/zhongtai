from __future__ import annotations

import os
import random
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass
class PostProcessResult:
    ok: bool
    status: str
    output_path: Optional[str] = None
    error: str = ""


_PUNCTUATION_WEIGHTS = {
    "，": 1.0,
    "、": 1.0,
    "；": 1.0,
    "。": 2.0,
    "！": 2.0,
    "？": 2.0,
    "：": 1.5,
    "—": 1.5,
    "…": 1.5,
}


def _escape_ass_text(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")


def _format_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int((seconds - int(seconds)) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _line_weight(line: str) -> float:
    weight = 0.0
    for ch in line:
        if ch.strip():
            weight += 1.0
        weight += _PUNCTUATION_WEIGHTS.get(ch, 0.0)
    return weight


def _auto_wrap(text: str, max_chars: int = 16) -> str:
    text = re.sub(r"\s+", " ", (text or "").strip())
    if len(text) <= max_chars:
        return text
    parts: list[str] = []
    while len(text) > max_chars:
        break_pos = -1
        for idx in range(min(max_chars, len(text)) - 1, max_chars // 2 - 1, -1):
            if text[idx] in "，。！？、；：":
                break_pos = idx + 1
                break
        if break_pos < max_chars // 2:
            break_pos = max_chars
        parts.append(text[:break_pos])
        text = text[break_pos:]
    if text:
        parts.append(text)
    return "\\N".join(parts)


def probe_duration(media_path: str) -> float:
    cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", media_path]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if res.returncode == 0 and res.stdout.strip():
        return max(0.1, float(res.stdout.strip()))
    return 30.0


def probe_resolution(video_path: str) -> tuple[int, int]:
    cmd = ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", video_path]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if res.returncode == 0 and "x" in res.stdout:
        w, h = res.stdout.strip().split("x", 1)
        return int(w), int(h)
    return 576, 1024


def has_audio_stream(video_path: str) -> bool:
    cmd = ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", video_path]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    return res.returncode == 0 and bool(res.stdout.strip())


def create_timeline_by_chars(script: str, duration: float) -> list[dict[str, float | str]]:
    lines = [line.strip() for line in script.splitlines() if line.strip()]
    if not lines:
        return []
    weights = [_line_weight(line) for line in lines]
    total_weight = sum(weights) or float(len(lines))
    timeline: list[dict[str, float | str]] = []
    cursor = 0.0
    for idx, line in enumerate(lines):
        raw_duration = duration * (weights[idx] / total_weight)
        line_duration = max(0.5, min(raw_duration, 30.0))
        if idx == len(lines) - 1:
            line_duration = max(0.5, duration - cursor)
        start = round(cursor, 3)
        end = round(cursor + line_duration, 3)
        timeline.append({"start": start, "duration": round(line_duration, 3), "end": end, "text": line})
        cursor += line_duration
    if timeline:
        timeline[-1]["end"] = round(duration, 3)
        timeline[-1]["duration"] = round(duration - float(timeline[-1]["start"]), 3)
    return timeline


def build_ass_subtitles(script: str, output_path: str, duration: float, width: int, height: int) -> None:
    timeline = create_timeline_by_chars(script, duration)
    if not timeline:
        raise ValueError("脚本内容为空，无法生成字幕时间轴")
    margin_v = int(height * 0.22) if height else 220
    ass = [
        "[Script Info]",
        "Title: Generated Subtitle",
        "ScriptType: v4.00+",
        "Collisions: Normal",
        "WrapStyle: 1",
        "PlayDepth: 0",
        f"PlayResX: {width}",
        f"PlayResY: {height}",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: Default,Microsoft YaHei,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,{margin_v},1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for row in timeline:
        text = _escape_ass_text(_auto_wrap(str(row["text"])))
        ass.append(f"Dialogue: 0,{_format_time(float(row['start']))},{_format_time(float(row['end']))},Default,,0,0,0,,{text}")
    Path(output_path).write_text("\n".join(ass), encoding="utf-8-sig")


def _run_ffmpeg(args: list[str], timeout: int = 900) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)


def _escape_filter_path(path_value: str) -> str:
    return path_value.replace("\\", "/").replace(":", "\\:").replace("'", "\\'")


def _drawtext_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("'", "\\'").replace(":", "\\:").replace(",", "\\,")


def _pick_bgm(bgm_dir: Optional[str]) -> Optional[str]:
    if not bgm_dir or not os.path.isdir(bgm_dir):
        return None
    files = [f for f in os.listdir(bgm_dir) if f.lower().endswith((".mp3", ".wav", ".aac", ".m4a"))]
    return os.path.join(bgm_dir, random.choice(files)) if files else None


def burn_subtitle_ffmpeg(input_video_path: str, ass_path: str, output_path: str, duration: float, business_card_text: str = "", bgm_dir: Optional[str] = None, preset: str = "smooth") -> PostProcessResult:
    width, height = probe_resolution(input_video_path)
    preset = (preset or "smooth").lower()
    preset_settings = {
        "smooth": {"video_filter": [], "audio_volume": 1.12, "bgm_volume": 0.0, "font_size": 40, "outline": 2, "speed": "medium"},
        "dynamic": {"video_filter": ["eq=contrast=1.08:saturation=1.12:brightness=0.02"], "audio_volume": 1.18, "bgm_volume": 0.32, "font_size": 42, "outline": 2, "speed": "fast"},
        "cinematic": {"video_filter": ["eq=contrast=1.12:saturation=1.06:brightness=-0.01"], "audio_volume": 1.10, "bgm_volume": 0.28, "font_size": 44, "outline": 3, "speed": "slow"},
        "subtle": {"video_filter": ["eq=contrast=1.04:saturation=1.02:brightness=0.0"], "audio_volume": 1.05, "bgm_volume": 0.0, "font_size": 38, "outline": 2, "speed": "medium"},
        "caption": {"video_filter": [], "audio_volume": 1.12, "bgm_volume": 0.0, "font_size": 46, "outline": 3, "speed": "medium"},
        "broll": {"video_filter": ["eq=contrast=1.05:saturation=1.08:brightness=0.0"], "audio_volume": 1.15, "bgm_volume": 0.26, "font_size": 40, "outline": 2, "speed": "fast"},
    }.get(preset, {})
    ass_filter = f"subtitles='{_escape_filter_path(ass_path)}'"
    filters = list(preset_settings.get("video_filter", [])) + [ass_filter]
    if business_card_text:
        lines = [line.strip() for line in business_card_text.replace("\r\n", "\n").replace("\r", "\n").split("\n") if line.strip()]
        line_h = 21
        base_y = max(0, (height - len(lines) * line_h) // 2)
        for idx, line in enumerate(lines):
            y = base_y + idx * line_h
            filters.append(
                "drawtext="
                f"text='{_drawtext_escape(line)}':font='Microsoft YaHei':fontcolor=white:fontsize=17:"
                f"x=20:y={y}:borderw=2:bordercolor=black@0.8"
            )
    vf = ",".join(filters)
    bgm_path = _pick_bgm(bgm_dir)
    audio_volume = float(preset_settings.get("audio_volume", 1.12))
    bgm_volume = float(preset_settings.get("bgm_volume", 0.0))
    font_size = int(preset_settings.get("font_size", 40))
    # 预留：后续可把 ASS 样式改成按 preset 动态生成
    _ = font_size
    if bgm_path and bgm_volume > 0:
        fc = (
            f"[0:a]volume={audio_volume:.2f},atrim=0:{duration:.3f},apad=whole_dur={duration:.3f},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[voice];"
            f"[1:a]atrim=0:{duration:.3f},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume={bgm_volume:.2f},"
            f"afade=t=in:st=0:d=1,afade=t=out:st={max(0, duration - 2):.3f}:d=2[music];"
            "[voice][music]amix=inputs=2:duration=first:dropout_transition=0[aout]"
        )
        cmd = ["ffmpeg", "-y", "-i", input_video_path, "-i", bgm_path, "-filter_complex", fc, "-map", "0:v", "-map", "[aout]", "-vf", vf, "-c:v", "libx264", "-preset", "fast", "-c:a", "aac", "-threads", "4", "-t", f"{duration:.3f}", output_path]
    elif has_audio_stream(input_video_path):
        fc = f"[0:a]volume={audio_volume:.2f},atrim=0:{duration:.3f},apad=whole_dur={duration:.3f},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[aout]"
        cmd = ["ffmpeg", "-y", "-i", input_video_path, "-filter_complex", fc, "-map", "0:v", "-map", "[aout]", "-vf", vf, "-c:v", "libx264", "-preset", "fast", "-c:a", "aac", "-threads", "4", "-t", f"{duration:.3f}", output_path]
    else:
        cmd = ["ffmpeg", "-y", "-i", input_video_path, "-vf", vf, "-c:v", "libx264", "-preset", "fast", "-threads", "4", "-t", f"{duration:.3f}", output_path]
    Path(os.path.join(os.path.dirname(output_path), "ffmpeg_burn_cmd.txt")).write_text(" ".join(cmd), encoding="utf-8")
    res = _run_ffmpeg(cmd)
    if res.returncode == 0 and os.path.exists(output_path):
        return PostProcessResult(True, "published", output_path)
    err = (res.stderr or "ffmpeg 字幕烧录失败")[-2000:]
    Path(os.path.join(os.path.dirname(output_path), "ffmpeg_burn_stderr.txt")).write_text(err, encoding="utf-8")
    return PostProcessResult(False, "failed", error=err)


def run_ffmpeg_post_process(task_id: str, input_video_path: str, output_dir: str, script: str, keep_original: bool = True, business_card_text: str = "", bgm_dir: Optional[str] = None, preset: str = "smooth", attempt: int = 0, max_retry: int = 2) -> PostProcessResult:
    os.makedirs(output_dir, exist_ok=True)
    if keep_original:
        try:
            shutil.copy2(input_video_path, os.path.join(output_dir, f"{task_id}_original.mp4"))
        except Exception:
            pass
    duration = probe_duration(input_video_path)
    width, height = probe_resolution(input_video_path)
    ass_path = os.path.join(output_dir, f"{task_id}.ass")
    build_ass_subtitles(script, ass_path, duration, width, height)
    output_path = os.path.join(output_dir, f"{task_id}_final.mp4")
    result = burn_subtitle_ffmpeg(input_video_path, ass_path, output_path, duration, business_card_text, bgm_dir, preset)
    if result.ok:
        try:
            os.remove(ass_path)
        except Exception:
            pass
        return result
    if attempt < max_retry:
        return run_ffmpeg_post_process(task_id, input_video_path, output_dir, script, keep_original, business_card_text, bgm_dir, preset, attempt + 1, max_retry)
    return result


def run_ffmpeg_post_process_from_base64(task_id: str, video_base64: str, output_dir: str, script: str, business_card_text: str = "", bgm_dir: Optional[str] = None, preset: str = "smooth") -> PostProcessResult:
    import base64
    input_path = os.path.join(output_dir, f"{task_id}_input.mp4")
    os.makedirs(output_dir, exist_ok=True)
    with open(input_path, "wb") as f:
        f.write(base64.b64decode(video_base64))
    return run_ffmpeg_post_process(task_id, input_path, output_dir, script, keep_original=True, business_card_text=business_card_text, bgm_dir=bgm_dir, preset=preset)
