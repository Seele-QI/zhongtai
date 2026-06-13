/**
 * 视频模块 API 客户端
 *
 * 集中管理对 FastAPI / Next API Route 的视频相关请求。
 * 所有实际 API 调用均通过此模块发起，便于后续替换 Mock 为真实服务。
 */
import type {
  VideoGenerateRequest,
  VideoGenerateResponse,
  VideoStatusResponse,
  VideoEditRequest,
  VideoEditResponse,
  VoiceCloneRequest,
  VoiceCloneResponse,
} from "./types"
import { getFastapiBase } from "@/lib/fastapi-base"

/**
 * 提交视频生成任务 → FastAPI POST /api/video/generate
 */
export async function submitVideoGeneration(
  req: VideoGenerateRequest,
): Promise<VideoGenerateResponse> {
  const base = getFastapiBase()
  const res = await fetch(`${base}/api/video/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(typeof data.detail === "string" ? data.detail : "提交任务失败")
  }
  return data as VideoGenerateResponse
}

/**
 * 查询视频任务状态 → FastAPI GET /api/video/status?taskId=xxx
 */
export async function queryVideoStatus(
  taskId: string,
): Promise<VideoStatusResponse> {
  const base = getFastapiBase()
  const res = await fetch(`${base}/api/video/status?taskId=${taskId}`)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(typeof data.detail === "string" ? data.detail : "查询状态失败")
  }
  return (await res.json()) as VideoStatusResponse
}

/**
 * 应用剪辑效果 → Next POST /api/video/edit (Remotion)
 */
export async function applyEdit(
  req: VideoEditRequest,
): Promise<VideoEditResponse> {
  const res = await fetch("/api/video/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(typeof data.detail === "string" ? data.detail : "剪辑失败")
  }
  return data as VideoEditResponse
}

/**
 * 音色克隆 → FastAPI POST /api/video/clone-voice
 */
export async function cloneVoice(
  req: VoiceCloneRequest,
): Promise<VoiceCloneResponse> {
  const base = getFastapiBase()
  const res = await fetch(`${base}/api/video/clone-voice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(typeof data.detail === "string" ? data.detail : "音色克隆失败")
  }
  return data as VoiceCloneResponse
}
