import { spawn } from "node:child_process"
import { existsSync, mkdirSync, copyFileSync, unlinkSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"

export type PostProcessStatus = "queued" | "running" | "retrying" | "published" | "failed"

export type PostProcessTask = {
  taskId: string
  inputVideoPath: string
  outputDir: string
  script: string
  coverPath?: string
  keepOriginal?: boolean
  attempt?: number
}

export type PostProcessResult = {
  ok: boolean
  status: PostProcessStatus
  outputPath?: string
  error?: string
}

const MAX_RETRY = 2
const SUBTITLE_FONT = "Microsoft YaHei"

function runCommand(command: string, args: string[], cwd?: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true })
    let stderr = ""
    child.stderr.on("data", (d) => (stderr += d.toString()))
    child.on("error", reject)
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }))
  })
}

function escapeAssText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\n/g, "")
}

function formatTime(seconds: number): string {
  const total = Math.max(0, seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  const cs = Math.floor((total - Math.floor(total)) * 100)
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`
}

function buildTimeline(script: string, duration = 30): Array<{ start: number; end: number; text: string }> {
  const text = script.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const lines = text.length ? text : [script.trim()].filter(Boolean)
  const totalChars = lines.reduce((sum, item) => sum + item.length, 0) || 1
  let cursor = 0
  return lines.map((line, idx) => {
    const weight = Math.max(1, line.length)
    const seg = duration * (weight / totalChars)
    const start = cursor
    const end = idx === lines.length - 1 ? duration : Math.min(duration, cursor + seg)
    cursor = end
    return { start, end, text: line }
  })
}

function buildSubtitleAss(script: string, outputPath: string): void {
  const timeline = buildTimeline(script, 30)
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 576\nPlayResY: 1024\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${SUBTITLE_FONT},40,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,2,0,2,20,20,220,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`
  const body = timeline.map((row) => `Dialogue: 0,${formatTime(row.start)},${formatTime(row.end)},Default,,0,0,0,,${escapeAssText(row.text)}`).join("\n")
  writeFileSync(outputPath, header + body, "utf-8")
}

function pickFirstMedia(dir: string): string | null {
  if (!existsSync(dir)) return null
  const items = readdirSync(dir)
  const hit = items.find((f) => /\.(mp4|mov|mkv|webm|avi)$/i.test(f))
  return hit ? path.join(dir, hit) : null
}

export async function runFfmpegPostProcess(task: PostProcessTask): Promise<PostProcessResult> {
  const attempt = task.attempt ?? 0
  const outDir = task.outputDir
  mkdirSync(outDir, { recursive: true })
  const assPath = path.join(outDir, `${task.taskId}.ass`)
  buildSubtitleAss(task.script, assPath)

  const outputPath = path.join(outDir, `${task.taskId}_final.mp4`)
  const subtitlePath = assPath.replace(/\\/g, "/").replace(/:/g, "\\:")
  const args = ["-y", "-i", task.inputVideoPath, "-vf", `subtitles='${subtitlePath}'`, "-c:v", "libx264", "-preset", "fast", "-c:a", "aac", outputPath]
  const r = await runCommand("ffmpeg", args)
  if (r.code === 0 && existsSync(outputPath)) {
    try {
      copyFileSync(task.inputVideoPath, path.join(outDir, `${task.taskId}_original.mp4`))
    } catch {
    }
    try { unlinkSync(assPath) } catch {}
    return { ok: true, status: "published", outputPath }
  }
  if (attempt < MAX_RETRY) {
    return runFfmpegPostProcess({ ...task, attempt: attempt + 1 })
  }
  return { ok: false, status: "failed", error: r.stderr.slice(-2000) || "ffmpeg 后处理失败" }
}

export function resolvePostProcessInput(videoUrl: string, fallbackDir: string): string | null {
  if (!videoUrl) return pickFirstMedia(fallbackDir)
  return videoUrl
}
