import importlib
import asyncio
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from tests.conftest import setup_test_db

setup_test_db()
os.environ["EMAIL_HASH_SALT"] = "test-salt"
os.environ["CREDIT_REGISTER_BONUS"] = "100"

import main  # noqa: E402
import lib.video_postprocess as video_postprocess  # noqa: E402
from lib.video_postprocess import (  # noqa: E402
    _clean_subtitle_text,
    burn_subtitle_ffmpeg,
    create_timeline_by_chars,
    resolve_target_duration,
    split_script_segments,
)


@patch("main.asyncio.create_task")
@patch("main._cleanup_temp")
@patch("main._base64_to_temp_file", new_callable=AsyncMock)
@patch("main._get_rh_client")
def test_video_generate_stores_default_postprocess_fields(
    mock_get_rh_client,
    mock_base64_to_temp_file,
    _mock_cleanup_temp,
    mock_create_task,
):
    def _fake_create_task(coro):
        coro.close()
        return object()

    image_path = "C:/tmp/input.png"
    audio_path = "C:/tmp/input.mp3"
    mock_base64_to_temp_file.side_effect = [image_path, audio_path]

    rh = SimpleNamespace(
        upload_file=AsyncMock(side_effect=["https://example.com/image.png", "https://example.com/audio.mp3"]),
        submit_audio_clone=AsyncMock(return_value="audio-clone-task"),
        wait_for_completion=AsyncMock(return_value={"results": [{"url": "https://example.com/audio-clone.mp3"}]}),
        submit_video=AsyncMock(return_value="video-task-123"),
    )
    mock_get_rh_client.return_value = rh
    mock_create_task.side_effect = _fake_create_task

    req = main.VideoGenerateRequest(
        image_base64="aW1hZ2U=",
        audio_base64="YXVkaW8=",
        script="第一句\n第二句",
    )

    resp = asyncio.run(main.video_generate(req))

    assert resp.task_id == "video-task-123"
    stored = main._task_store["video-task-123"]
    assert stored["preset"] == "smooth"
    assert stored["bgm_dir"] == ""
    assert stored["bgm_volume"] == 0.32
    assert stored["business_card_text"] == ""


def test_clean_subtitle_text_removes_punctuation():
    cleaned = _clean_subtitle_text("你好，世界。/AI字幕！")
    assert cleaned == "你好世界AI字幕"


def test_split_script_segments_splits_by_breaks_and_drops_empty_parts():
    segments = split_script_segments("第一句，第二句。\n\n第三句/第四句！？")
    assert segments == ["第一句", "第二句", "第三句", "第四句"]


def test_timeline_total_duration_matches_target():
    timeline = create_timeline_by_chars("第一句。\n第二句更长一点。", 40.0)
    assert timeline
    assert float(timeline[-1]["end"]) == 40.0
    total = sum(float(item["duration"]) for item in timeline)
    assert round(total, 3) == 40.0


def test_resolve_target_duration_prefers_audio_duration(monkeypatch):
    monkeypatch.setattr(video_postprocess, "probe_audio_duration", lambda _: 40.0)
    monkeypatch.setattr(video_postprocess, "probe_duration", lambda _: 55.0)
    assert resolve_target_duration("demo.mp4") == 40.0


def test_resolve_target_duration_does_not_exceed_video_duration(monkeypatch):
    monkeypatch.setattr(video_postprocess, "probe_audio_duration", lambda _: 55.0)
    monkeypatch.setattr(video_postprocess, "probe_duration", lambda _: 40.0)
    assert resolve_target_duration("demo.mp4") == 40.0


def test_ffprobe_falls_back_to_ffprobe_binary_when_local_tool_missing(monkeypatch):
    original_exists = video_postprocess.Path.exists

    def fake_exists(path_obj):
        if path_obj.name in {"ffprobe.exe", "ffmpeg.exe"}:
            return False
        return original_exists(path_obj)

    monkeypatch.setattr(video_postprocess.Path, "exists", fake_exists)
    reloaded = importlib.reload(video_postprocess)
    try:
        assert reloaded._FFMPEG_EXE == "ffmpeg"
        assert reloaded._FFPROBE_EXE == "ffprobe"
    finally:
        importlib.reload(video_postprocess)


@patch("lib.video_postprocess._run_ffmpeg")
@patch("lib.video_postprocess.has_audio_stream", return_value=True)
@patch("lib.video_postprocess._pick_bgm", return_value="C:/bgm/demo.mp3")
@patch("lib.video_postprocess.probe_resolution", return_value=(576, 1024))
def test_burn_subtitle_ffmpeg_uses_bgm_mix_and_no_visual_filters(
    _probe_resolution,
    _pick_bgm,
    _has_audio_stream,
    mock_run_ffmpeg,
    tmp_path,
):
    output_path = tmp_path / "final.mp4"
    ass_path = tmp_path / "demo.ass"
    ass_path.write_text("dummy", encoding="utf-8")
    output_path.write_bytes(b"ok")
    mock_run_ffmpeg.return_value = SimpleNamespace(returncode=0, stderr="")

    result = burn_subtitle_ffmpeg(
        "C:/video/input.mp4",
        str(ass_path),
        str(output_path),
        40.0,
        business_card_text="",
        bgm_dir="C:/bgm",
        preset="smooth",
        bgm_volume=0.32,
    )

    assert result.ok is True
    cmd = mock_run_ffmpeg.call_args.args[0]
    cmd_text = " ".join(cmd)
    assert "amix=inputs=2" in cmd_text
    assert "subtitles=" in cmd_text
    assert "drawtext=" not in cmd_text
    assert "eq=" not in cmd_text
    assert "curves=" not in cmd_text
    assert "boxblur=" not in cmd_text


@patch("lib.video_postprocess._run_ffmpeg")
@patch("lib.video_postprocess.has_audio_stream", return_value=False)
@patch("lib.video_postprocess._pick_bgm", return_value="C:/bgm/demo.mp3")
@patch("lib.video_postprocess.probe_resolution", return_value=(576, 1024))
def test_burn_subtitle_ffmpeg_keeps_bgm_when_input_has_no_audio_stream(
    _probe_resolution,
    _pick_bgm,
    _has_audio_stream,
    mock_run_ffmpeg,
    tmp_path,
):
    output_path = tmp_path / "final.mp4"
    ass_path = tmp_path / "demo.ass"
    ass_path.write_text("dummy", encoding="utf-8")
    output_path.write_bytes(b"ok")
    mock_run_ffmpeg.return_value = SimpleNamespace(returncode=0, stderr="")

    result = burn_subtitle_ffmpeg(
        "C:/video/input.mp4",
        str(ass_path),
        str(output_path),
        18.0,
        business_card_text="",
        bgm_dir="C:/bgm",
        preset="smooth",
        bgm_volume=0.32,
    )

    assert result.ok is True
    cmd = mock_run_ffmpeg.call_args.args[0]
    cmd_text = " ".join(cmd)
    assert "-stream_loop" in cmd
    assert "anullsrc" in cmd_text
    assert "amix=inputs=2" in cmd_text
    assert "subtitles=" in cmd_text
    assert (tmp_path / "ffmpeg_bgm_choice.txt").read_text(encoding="utf-8") == "C:/bgm/demo.mp3"


@patch("main.asyncio.to_thread", new_callable=AsyncMock)
@patch("main.httpx.AsyncClient")
def test_run_post_process_passes_bgm_related_arguments(mock_client_cls, mock_to_thread):
    task_id = "task-123"
    main._task_store[task_id] = {
        "task_id": task_id,
        "script": "第一句\n第二句",
        "business_card_text": "品牌名片",
        "bgm_dir": "bgm/smooth",
        "bgm_volume": 0.25,
        "preset": "caption",
    }

    mock_client = mock_client_cls.return_value.__aenter__.return_value
    mock_response = type("Resp", (), {"content": b"video", "raise_for_status": lambda self: None})()
    mock_client.get = AsyncMock(return_value=mock_response)
    mock_to_thread.return_value = SimpleNamespace(ok=False, output_path=None, error="boom")

    asyncio.run(main._run_post_process(task_id, "https://example.com/video.mp4"))

    args = mock_to_thread.call_args.args
    assert args[0].__name__ == "run_ffmpeg_post_process"
    assert args[5] is True
    assert args[6] == "品牌名片"
    assert args[7] == "bgm/smooth"
    assert args[8] == "caption"
    assert args[9] == 0.25
