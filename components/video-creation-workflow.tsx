"use client"

import * as React from "react"
import {
  Upload, Image as ImageIcon, Mic, FileText, Play, Clapperboard,
  CheckCircle2, Loader2, AlertCircle, Sparkles, Zap,
  Wand2, Scissors, RefreshCw, Download,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { toast } from "@/hooks/use-toast"
import { getFastapiBase } from "@/lib/fastapi-base"
import type { StepId, StepStatus } from "@/lib/video/types"
import { ACCEPTED_IMAGES, ACCEPTED_AUDIO, MAX_FILE_SIZE, POLL_INTERVAL_MS } from "@/lib/video/constants"
import { fileToBase64, formatSize } from "@/lib/video/utils"
import { submitVideoGeneration, queryVideoStatus, applyEdit } from "@/lib/video/api"
import { addHistoryRecord, addShareVideo } from "@/lib/video/storage"
import { StepIndicator } from "@/components/video/step-indicator"
import { UploadZone } from "@/components/video/upload-zone"
import type { UploadedImage, UploadedAudio } from "@/lib/video/types"

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const EDITING_PRESETS = [
  { id: "smooth", name: "流畅剪辑", icon: Scissors, description: "自动去除停顿与冗余，保持自然节奏" },
  { id: "dynamic", name: "动感快剪", icon: Zap, description: "快节奏卡点，适合产品展示与宣传" },
  { id: "cinematic", name: "电影质感", icon: Clapperboard, description: "电影级调色与转场，适合品牌大片" },
  { id: "subtle", name: "轻量美化", icon: Sparkles, description: "微调亮度对比度，保持原片质感" },
  { id: "caption", name: "字幕增强", icon: FileText, description: "自动生成动态字幕，重点高亮" },
  { id: "broll", name: "B-Roll 混剪", icon: Wand2, description: "自动插入素材库镜头，丰富画面层次" },
]

type Props = {
  initialScript?: string
}

export function VideoCreationWorkflow({ initialScript }: Props) {
  // Step 1 state
  const [image, setImage] = React.useState<UploadedImage | null>(null)
  const [audio, setAudio] = React.useState<UploadedAudio | null>(null)
  const [script, setScript] = React.useState(initialScript ?? "")
  const [gender, setGender] = React.useState<"male" | "female">("female")

  // Workflow state
  const [activeStep, setActiveStep] = React.useState<StepId>(1)
  const [stepStatuses, setStepStatuses] = React.useState<Record<StepId, StepStatus>>({
    1: "active", 2: "pending", 3: "pending", 4: "pending",
  })
  const [isProcessing, setIsProcessing] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState("")
  const [selectedPreset, setSelectedPreset] = React.useState<string | null>(null)
  const [taskId, setTaskId] = React.useState("")
  const [progress, setProgress] = React.useState(0)
  const [videoUrl, setVideoUrl] = React.useState("")
  const [isEditing, setIsEditing] = React.useState(false)
  const [coverUrl, setCoverUrl] = React.useState("")

  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  React.useEffect(() => {
    if (initialScript) setScript(initialScript)
  }, [initialScript])

  React.useEffect(() => {
    return () => {
      if (image?.previewUrl) URL.revokeObjectURL(image.previewUrl)
    }
  }, [image?.previewUrl])

  const canGenerate = !!(image && audio && script.trim())

  const handleImageFile = React.useCallback(async (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      toast({ title: "文件过大", description: "图片最大支持 50MB", variant: "destructive" })
      return
    }
    try {
      setImage({ file, previewUrl: URL.createObjectURL(file), base64: await fileToBase64(file) })
    } catch {
      toast({ title: "读取失败", description: "无法读取图片文件", variant: "destructive" })
    }
  }, [])

  const handleAudioFile = React.useCallback(async (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      toast({ title: "文件过大", description: "音频最大支持 50MB", variant: "destructive" })
      return
    }
    try {
      const base64 = await fileToBase64(file)
      setAudio({ file, name: file.name, duration: "0:32", base64 })
    } catch {
      toast({ title: "读取失败", description: "无法读取音频文件", variant: "destructive" })
    }
  }, [])

  const startPolling = React.useCallback((tid: string) => {
    const base = getFastapiBase()
    pollRef.current = setInterval(async () => {
      try {
        const sd = await queryVideoStatus(tid)
        const s = sd.status?.toLowerCase()
        if (s === "success") {
          clearInterval(pollRef.current!)
          pollRef.current = null
          const vUrl = sd.video_url || sd.videoUrl || ""
          const cUrl = sd.cover_url || sd.coverUrl || ""
          setVideoUrl(vUrl)
          if (cUrl) setCoverUrl(cUrl)
          setProgress(100)
          setStepStatuses((prev) => ({ ...prev, 3: "done", 4: "active" }))
          setActiveStep(4)
          setIsProcessing(false)
          addHistoryRecord({
            id: tid, createdAt: Date.now(), script: script.trim(),
            videoUrl: vUrl, coverUrl: cUrl, gender, status: "success",
          })
          if (vUrl) {
            addShareVideo({
              id: tid, title: script.trim().slice(0, 30), url: vUrl,
              thumbnail: cUrl || undefined, source: "video-creation", createdAt: Date.now(),
            })
          }
        } else if (s === "failed") {
          clearInterval(pollRef.current!); pollRef.current = null
          const errMsg = sd.error || sd.detail || "生成失败"
          setErrorMessage(errMsg)
          setStepStatuses((prev) => ({ ...prev, 3: "error" }))
          setIsProcessing(false)
          addHistoryRecord({
            id: tid, createdAt: Date.now(), script: script.trim(),
            videoUrl: "", coverUrl: "", gender, status: "failed", errorMessage: errMsg,
          })
        } else if (typeof sd.progress === "number") {
          setProgress((p) => Math.max(p, sd.progress ?? 0))
        }
      } catch { /* ignore polling errors */ }
    }, POLL_INTERVAL_MS)
  }, [script, gender])

  const handleGenerate = React.useCallback(async () => {
    if (!canGenerate || isProcessing) return
    const base = getFastapiBase()
    if (!base) {
      toast({ title: "缺少后端配置", description: "请配置 NEXT_PUBLIC_FASTAPI_URL", variant: "destructive" })
      return
    }
    setIsProcessing(true)
    setErrorMessage("")
    setVideoUrl("")
    setActiveStep(2)
    setStepStatuses((prev) => ({ ...prev, 1: "done", 2: "loading" }))

    try {
      const data = await submitVideoGeneration({
        image_base64: image!.base64,
        audio_base64: audio!.base64,
        script: script.trim(),
        gender,
      })
      const tid = data.task_id || data.taskId
      if (!tid) throw new Error("未返回 taskId")
      setTaskId(tid)
      setStepStatuses((prev) => ({ ...prev, 2: "done", 3: "loading" }))
      setActiveStep(3)
      startPolling(tid)
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "生成过程出错，请重新点击生成")
      setStepStatuses((prev) => ({ ...prev, 3: "error" }))
      setIsProcessing(false)
    }
  }, [canGenerate, isProcessing, image, audio, script, gender, startPolling])

  React.useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const handleRetry = React.useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    setActiveStep(1)
    setStepStatuses({ 1: "active", 2: "pending", 3: "pending", 4: "pending" })
    setErrorMessage(""); setProgress(0); setTaskId(""); setVideoUrl(""); setIsProcessing(false)
  }, [])

  const steps = [
    { id: 1 as StepId, label: "素材准备", status: stepStatuses[1] },
    { id: 2 as StepId, label: "音色克隆", status: stepStatuses[2] },
    { id: 3 as StepId, label: "视频生成", status: stepStatuses[3] },
    { id: 4 as StepId, label: "自动剪辑", status: stepStatuses[4] },
  ]

  return (
    <div className="h-full overflow-y-auto bg-[#fafaf8] dark:bg-slate-950">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-10">

        {/* Hero */}
        <header className="mb-8">
          <div className="mb-4 h-1 w-12 rounded-full bg-rose-500/60" />
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-slate-900 sm:text-[34px] dark:text-slate-50">
            AI<span className="text-rose-500 dark:text-rose-400"> 视频创作</span>
          </h1>
          <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-slate-500 dark:text-slate-400">
            上传形象照片与参考音色，输入口播文案，AI 自动完成音色克隆、数字人口播生成与智能剪辑
          </p>
        </header>

        {/* Step Indicator */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <StepIndicator steps={steps} />
          {taskId && <span className="text-[11px] text-slate-400">任务 ID：{taskId}</span>}
        </div>

        {/* Step 1: Material Upload */}
        {activeStep >= 1 && (
          <section className={cn("space-y-5", activeStep > 1 && "opacity-50 pointer-events-none")}>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-100 text-[11px] font-bold text-rose-600 dark:bg-rose-500/20 dark:text-rose-400">1</span>
              <h2 className="text-[16px] font-semibold text-slate-800 dark:text-slate-200">素材准备</h2>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {/* Image */}
              <div>
                {image ? (
                  <div className="relative overflow-hidden rounded-2xl border border-slate-200/60 bg-white dark:border-white/10 dark:bg-white/5">
                    <img src={image.previewUrl} alt="数字人形象" className="aspect-square w-full object-cover" />
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent p-3">
                      <span className="text-[11px] text-white">形象照片</span>
                      <button type="button" onClick={() => setImage(null)}
                        className="rounded-lg bg-white/20 px-2 py-0.5 text-[11px] text-white backdrop-blur hover:bg-white/30">更换</button>
                    </div>
                  </div>
                ) : (
                  <UploadZone accept={ACCEPTED_IMAGES} label="上传数字人形象" icon={ImageIcon} hint="JPG / PNG / WebP" onFile={handleImageFile} />
                )}
              </div>

              {/* Audio */}
              <div>
                {audio ? (
                  <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/60 bg-white p-5 dark:border-white/10 dark:bg-white/5">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-500/10">
                        <Mic className="h-5 w-5 text-rose-400" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-slate-700 dark:text-slate-300">{audio.name}</p>
                        <p className="text-[11px] text-slate-400">{formatSize(audio.file.size)} · {audio.duration}</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => setAudio(null)}
                      className="self-end rounded-lg bg-slate-100 px-3 py-1 text-[11px] text-slate-500 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10">更换</button>
                  </div>
                ) : (
                  <UploadZone accept={ACCEPTED_AUDIO} label="上传参考音色" icon={Mic} hint="MP3 / WAV / M4A" onFile={handleAudioFile} />
                )}
              </div>

              {/* Script */}
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/60 bg-white p-5 dark:border-white/10 dark:bg-white/5">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 dark:bg-rose-500/10">
                    <FileText className="h-4 w-4 text-rose-400" />
                  </span>
                  <span className="text-[13px] font-medium text-slate-700 dark:text-slate-300">口播文案</span>
                  <span className="ml-auto text-[11px] text-slate-400">{script.length} 字</span>
                </div>
                <textarea
                  className="min-h-[100px] flex-1 resize-none rounded-xl border border-slate-200/60 bg-slate-50/50 p-3 text-[13px] leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-500/15 dark:border-white/5 dark:bg-white/5 dark:text-slate-200"
                  placeholder="手动输入口播文案，或从文案创作板块一键导入…"
                  value={script} onChange={(e) => setScript(e.target.value)}
                />
                {initialScript && (
                  <p className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" />已从文案创作导入
                  </p>
                )}
              </div>
            </div>

            {/* Gender */}
            <div className="flex items-center justify-center gap-3">
              <span className="text-[13px] font-medium text-slate-600 dark:text-slate-400">数字人性别：</span>
              <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-white/10">
                {(["female", "male"] as const).map((g) => (
                  <button key={g} type="button" onClick={() => setGender(g)}
                    className={cn(
                      "rounded-lg px-4 py-1.5 text-[13px] font-medium transition-all",
                      gender === g
                        ? (g === "female"
                          ? "bg-white text-rose-600 shadow-sm dark:bg-rose-500/20 dark:text-rose-400"
                          : "bg-white text-blue-600 shadow-sm dark:bg-blue-500/20 dark:text-blue-400")
                        : "text-slate-500 hover:text-slate-700 dark:text-slate-400",
                    )}
                  >{g === "female" ? "女" : "男"}</button>
                ))}
              </div>
            </div>

            {/* Generate Button */}
            <div className="flex items-center justify-center border-t border-slate-100 pt-5 dark:border-white/5">
              <Button onClick={handleGenerate} disabled={!canGenerate || isProcessing}
                className={cn(
                  "inline-flex items-center gap-2 rounded-2xl px-8 py-3.5 text-[15px] font-bold shadow-lg transition-all duration-300",
                  canGenerate && !isProcessing
                    ? "bg-gradient-to-r from-rose-500 to-pink-500 text-white shadow-rose-500/25 hover:from-rose-600 hover:to-pink-600 active:scale-[0.97]"
                    : "bg-slate-100 text-slate-400 dark:bg-white/5 dark:text-slate-600",
                )}
              >
                {isProcessing ? (
                  <><Loader2 className="h-5 w-5 animate-spin" />生成中…</>
                ) : (
                  <><Play className="h-5 w-5" />一键生成口播视频<span className="ml-1 text-[12px] font-normal opacity-75">· 约 20-50 分钟</span></>
                )}
              </Button>
            </div>
          </section>
        )}

        {/* Step 2-3: Processing */}
        {(activeStep === 2 || activeStep === 3) && (
          <section className="mt-6 rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
            {/* Step 2 */}
            <div className={cn("flex items-start gap-4", activeStep === 3 && "mb-4 pb-4 border-b border-slate-100 dark:border-white/5")}>
              <StatusIcon status={stepStatuses[2]} stepNum={2} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">音色克隆</p>
                <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">
                  {stepStatuses[2] === "loading" ? "正在使用参考音频进行音色克隆…"
                    : stepStatuses[2] === "done" ? "音色克隆完成，已生成专属 TTS 音色"
                    : "等待上一步完成"}
                </p>
              </div>
            </div>

            {/* Step 3 */}
            {activeStep >= 3 && (
              <div className="flex items-start gap-4">
                <StatusIcon status={stepStatuses[3]} stepNum={3} />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">数字人口播视频生成</p>
                  <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">
                    {stepStatuses[3] === "loading" ? "正在使用克隆音色 + 数字人形象生成口播视频，预计 20-50 分钟…"
                      : stepStatuses[3] === "done" ? "视频生成完成！"
                      : stepStatuses[3] === "error" ? "生成失败，请检查素材后重新生成"
                      : "等待上一步完成"}
                  </p>
                  {stepStatuses[3] === "loading" && (
                    <div className="mt-3 space-y-1.5">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                        <div className="h-full rounded-full bg-gradient-to-r from-rose-500 to-pink-500 transition-all duration-500" style={{ width: `${progress}%` }} />
                      </div>
                      <p className="text-[11px] text-slate-400">{progress}%</p>
                    </div>
                  )}
                  {(stepStatuses[3] === "error" || errorMessage) && (
                    <div className="mt-3 rounded-xl border border-amber-200/60 bg-amber-50/50 p-3 dark:border-amber-500/20 dark:bg-amber-500/5">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                        <div>
                          <p className="text-[13px] font-medium text-amber-800 dark:text-amber-300">生成失败</p>
                          <p className="text-[12px] text-amber-700 dark:text-amber-400">{errorMessage || "服务端返回错误，请重新点击生成按钮。"}</p>
                        </div>
                      </div>
                      <button type="button" onClick={handleRetry}
                        className="mt-2 inline-flex items-center gap-1 rounded-lg bg-amber-100 px-3 py-1.5 text-[12px] font-medium text-amber-700 transition-colors hover:bg-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20">
                        <RefreshCw className="h-3.5 w-3.5" />重新生成
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Step 4: Preview + Editing */}
        {activeStep >= 4 && (
          <section className="mt-6 space-y-5">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-100 text-[11px] font-bold text-rose-600 dark:bg-rose-500/20 dark:text-rose-400">4</span>
              <h2 className="text-[16px] font-semibold text-slate-800 dark:text-slate-200">预览与剪辑</h2>
            </div>

            {videoUrl ? (
              <div className="overflow-hidden rounded-2xl border border-slate-200/60 bg-black">
                <video src={videoUrl} controls className="w-full" style={{ maxHeight: "480px" }} poster={image?.previewUrl}>
                  您的浏览器不支持视频播放
                </video>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 py-12 dark:border-white/10">
                <Clapperboard className="h-10 w-10 text-slate-300 dark:text-slate-600" />
                <p className="text-[14px] text-slate-400">视频正在生成中，完成后将在此预览</p>
              </div>
            )}

            {videoUrl && (
              <div className="flex items-start gap-4 rounded-2xl border border-slate-200/60 bg-white p-4 dark:border-white/10 dark:bg-white/5">
                <div className="h-28 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-white/5">
                  {coverUrl ? (
                    <img src={coverUrl} alt="封面图" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">视频封面</p>
                  <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
                    {coverUrl ? "竖屏 3:4 封面图，可下载使用" : "封面图自动生成中…"}
                  </p>
                  {coverUrl && (
                    <a href={coverUrl} target="_blank" rel="noopener noreferrer" download
                      className="mt-2 inline-flex items-center gap-1 rounded-lg bg-rose-50 px-3 py-1.5 text-[12px] font-medium text-rose-600 transition-colors hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20">
                      <Download className="h-3.5 w-3.5" />下载封面
                    </a>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-slate-600 dark:text-slate-400">选择剪辑效果</span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {EDITING_PRESETS.map((preset) => (
                <button
                  key={preset.id} type="button" onClick={() => setSelectedPreset(preset.id)}
                  className={cn(
                    "flex items-start gap-3 rounded-2xl border p-4 text-left transition-all duration-200",
                    selectedPreset === preset.id
                      ? "border-rose-400/60 bg-rose-50/50 shadow-sm dark:border-rose-500/40 dark:bg-rose-500/10"
                      : "border-slate-200/60 bg-white hover:border-slate-300 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20",
                  )}
                >
                  <span className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                    selectedPreset === preset.id ? "bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400" : "bg-slate-50 text-slate-400 dark:bg-white/5",
                  )}>
                    <preset.icon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-[14px] font-semibold text-slate-800 dark:text-slate-200">{preset.name}</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">{preset.description}</p>
                  </div>
                  {selectedPreset === preset.id && <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-rose-500" />}
                </button>
              ))}
            </div>

            {selectedPreset && (
              <div className="flex justify-center border-t border-slate-100 pt-5 dark:border-white/5">
                <Button onClick={async () => {
                  if (!selectedPreset || isEditing) return
                  setIsEditing(true)
                  try {
                    const data = await applyEdit({ videoUrl, preset: selectedPreset, subtitleText: script.trim() })
                    if (data.editedVideoUrl) {
                      setVideoUrl(data.editedVideoUrl)
                      toast({ title: "剪辑完成", description: "视频已应用所选效果，可切换预设再次剪辑" })
                    }
                  } catch (e) {
                    toast({ title: "剪辑失败", description: e instanceof Error ? e.message : "请重试", variant: "destructive" })
                  } finally { setIsEditing(false) }
                }} disabled={isEditing}
                  className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-rose-500 to-pink-500 px-8 py-3.5 text-[15px] font-bold text-white shadow-lg shadow-rose-500/25 transition-all hover:from-rose-600 hover:to-pink-600 active:scale-[0.97] disabled:opacity-60"
                >
                  {isEditing ? <><Loader2 className="h-5 w-5 animate-spin" />渲染中…</> : <><Wand2 className="h-5 w-5" />应用剪辑效果</>}
                </Button>
              </div>
            )}
          </section>
        )}

        {/* Success */}
        {stepStatuses[3] === "done" && activeStep === 4 && !selectedPreset && (
          <div className="mt-6 rounded-2xl border border-emerald-200/60 bg-emerald-50/50 p-5 dark:border-emerald-500/20 dark:bg-emerald-500/5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
              <div>
                <p className="text-[14px] font-semibold text-emerald-800 dark:text-emerald-300">视频生成成功！</p>
                <p className="text-[13px] text-emerald-700 dark:text-emerald-400">请选择上方预设剪辑效果，AI 将自动完成后期制作。</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** 步骤状态图标子组件 */
function StatusIcon({ status, stepNum }: { status: StepStatus; stepNum: number }) {
  return (
    <span className={cn(
      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
      status === "done" ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
        : status === "loading" ? "bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400"
        : status === "error" ? "bg-amber-100 text-amber-600"
        : "bg-slate-100 text-slate-400",
    )}>
      {status === "done" ? <CheckCircle2 className="h-4 w-4" />
        : status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" />
        : status === "error" ? <AlertCircle className="h-4 w-4" />
        : <span className="text-[11px] font-bold">{stepNum}</span>}
    </span>
  )
}
