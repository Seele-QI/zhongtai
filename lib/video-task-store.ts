/**
 * 视频创作任务状态持久化层（localStorage）
 *
 * 解决的问题：用户提交视频创作任务后，切换 sidebar 到其他板块，
 * 组件卸载 → useState 状态丢失 → 回来看到 "请选择视频" 初始状态。
 * 实际后端 _task_store 还在跑（20-50 分钟），但前端 UI 已被重置。
 *
 * 方案：把核心任务状态写到 localStorage，跨页面/刷新/重开浏览器都保留。
 */

const STORAGE_KEY = "video-creation-task"

export type TaskStatus = "pending" | "scanning" | "polling" | "success" | "failed"

export type VideoTaskState = {
  // 任务标识
  taskId: string

  // 任务状态
  status: TaskStatus
  progress: number
  isProcessing: boolean
  errorMessage: string

  // 产出
  videoUrl: string
  coverUrl: string

  // 输入
  script: string
  gender: "male" | "female"

  // 素材
  imageBase64: string
  imagePreview: string
  audioBase64: string
  audioName: string
  audioDuration: string

  // 剪辑
  selectedPreset: string
  isEditing: boolean
  qrDataUrl: string
  shareUrl: string
  copied: boolean

  // 时间
  createdAt: number
  updatedAt: number
}

const DEFAULT_STATE: Omit<VideoTaskState, "taskId" | "createdAt" | "updatedAt"> = {
  status: "pending",
  progress: 0,
  isProcessing: false,
  errorMessage: "",
  videoUrl: "",
  coverUrl: "",
  script: "",
  gender: "female",
  imageBase64: "",
  imagePreview: "",
  audioBase64: "",
  audioName: "",
  audioDuration: "",
  selectedPreset: "",
  isEditing: false,
  qrDataUrl: "",
  shareUrl: "",
  copied: false,
}

/** 从 localStorage 读取任务状态 */
export function loadTask(): VideoTaskState | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as VideoTaskState
  } catch {
    return null
  }
}

/** 保存任务状态到 localStorage */
export function saveTask(state: Partial<VideoTaskState>): void {
  if (typeof window === "undefined") return
  try {
    const prev = loadTask() || ({} as VideoTaskState)
    const merged: VideoTaskState = {
      ...DEFAULT_STATE,
      ...prev,
      ...state,
      updatedAt: Date.now(),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  } catch {
    /* quota exceeded or storage unavailable */
  }
}

/** 清除任务状态（任务完成/失败/重置时调用） */
export function clearTask(): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch { /* silent */ }
}

/** 创建一个新的任务状态（生成新的 taskId） */
export function createNewTask(): VideoTaskState {
  const now = Date.now()
  return {
    ...DEFAULT_STATE,
    taskId: "",
    createdAt: now,
    updatedAt: now,
  }
}
