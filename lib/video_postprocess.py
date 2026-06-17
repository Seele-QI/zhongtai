from __future__ import annotations

import os
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass
class PostProcessResult:
    ok: bool
    status: str
    output_path: Optional[str] = None
    error: str = ""


def _escape_ass_text(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")


def _format_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int((seconds - int(seconds)) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def create_timeline_by_chars(script: str, duration: float) -> list[tuple[float, float, str]]:
    lines = [line.strip() for line in script.splitlines() if line.strip()]
    if not lines:
        lines = [script.strip()]
    lines = [line for line in lines if line]
    total_chars = sum(len(line) for line in lines) or 1
    timeline = []
    cursor = 0.0
    for idx, line in enumerate(lines):
        seg = duration * (len(line) / total_chars)
        start = cursor
        end = duration if idx == len(lines) - 1 else min(duration, cursor + seg)
        timeline.append((start, end, line))
        cursor = end
    return timeline


def build_ass_subtitles(script: str, output_path: str, duration: float = 30.0) -> None:
    timeline = create_timeline_by_chars(script, duration)
    ass = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: 576",
        "PlayResY: 1024",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Default,Microsoft YaHei,40,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,2,0,2,20,20,220,1",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for start, end, text in timeline:
        ass.append(f"Dialogue: 0,{_format_time(start)},{_format_time(end)},Default,,0,0,0,,{_escape_ass_text(text)}")
    Path(output_path).write_text("\n".join(ass), encoding="utf-8")


def _run_ffmpeg(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900)


def run_ffmpeg_post_process(task_id: str, input_video_path: str, output_dir: str, script: str, keep_original: bool = True, attempt: int = 0, max_retry: int = 2) -> PostProcessResult:
    os.makedirs(output_dir, exist_ok=True)
    ass_path = os.path.join(output_dir, f"{task_id}.ass")
    build_ass_subtitles(script, ass_path)
    output_path = os.path.join(output_dir, f"{task_id}_final.mp4")
    ass_for_ffmpeg = ass_path.replace("\\", "/").replace(":", "\\:")
    cmd = ["ffmpeg", "-y", "-i", input_video_path, "-vf", f"subtitles='{ass_for_ffmpeg}'", "-c:v", "libx264", "-preset", "fast", "-c:a", "aac", output_path]
    res = _run_ffmpeg(cmd)
    if res.returncode == 0 and os.path.exists(output_path):
        if keep_original:
            try:
                import shutil
                shutil.copy2(input_video_path, os.path.join(output_dir, f"{task_id}_original.mp4"))
            except Exception:
                pass
        try:
            os.remove(ass_path)
        except Exception:
            pass
        return PostProcessResult(True, "published", output_path)
    if attempt < max_retry:
        return run_ffmpeg_post_process(task_id, input_video_path, output_dir, script, keep_original, attempt + 1, max_retry)
    return PostProcessResult(False, "failed", error=(res.stderr or "ffmpeg 后处理失败")[-2000:])
