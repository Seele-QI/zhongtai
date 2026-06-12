"use client"

import * as React from "react"
import { Trash2, Eye, Clock, Film, Download, Image as ImageIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "@/hooks/use-toast"

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type HistoryRecord = {
  id: string
  createdAt: number
  script: string
  videoUrl: string
  coverUrl: string
  gender: "male" | "female"
  status: "success" | "failed"
  errorMessage?: string
}

const STORAGE_KEY = "video-history"
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000 // 14 days

/* ------------------------------------------------------------------ */
/*  Storage helpers                                                     */
/* ------------------------------------------------------------------ */

function loadHistory(): HistoryRecord[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const data: HistoryRecord[] = JSON.parse(raw)
    const cutoff = Date.now() - MAX_AGE_MS
    return data.filter((r) => r.createdAt > cutoff).sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

function saveHistory(records: HistoryRecord[]) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch { /* quota exceeded — silently skip */ }
}

/** 外部调用：新增一条历史记录 */
export function addHistoryRecord(record: HistoryRecord) {
  const records = loadHistory()
  const idx = records.findIndex((r) => r.id === record.id)
  if (idx >= 0) {
    records[idx] = record
  } else {
    records.unshift(record)
  }
  saveHistory(records)
}

/* ------------------------------------------------------------------ */
/*  共享视频库（一键分发用）                                             */
/* ------------------------------------------------------------------ */

export type ShareVideo = {
  id: string
  title: string
  url: string
  thumbnail?: string
  duration?: string
  source: "manual" | "video-creation" | "batch-edit"
  createdAt: number
}

const SHARE_VIDEOS_KEY = "share-videos"

export function loadShareVideos(): ShareVideo[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(SHARE_VIDEOS_KEY)
    return raw ? (JSON.parse(raw) as ShareVideo[]) : []
  } catch {
    return []
  }
}

function saveShareVideos(videos: ShareVideo[]) {
  if (typeof window === "undefined") return
  localStorage.setItem(SHARE_VIDEOS_KEY, JSON.stringify(videos))
}

export function addShareVideo(video: ShareVideo) {
  const videos = loadShareVideos()
  const idx = videos.findIndex((v) => v.id === video.id)
  if (idx >= 0) {
    videos[idx] = video
  } else {
    videos.unshift(video)
  }
  saveShareVideos(videos)
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function getExcerpt(text: string, max = 50): string {
  return text.length > max ? text.slice(0, max) + "…" : text
}

export function VideoHistory() {
  const [records, setRecords] = React.useState<HistoryRecord[]>([])

  React.useEffect(() => {
    setRecords(loadHistory())
  }, [])

  const handleDelete = (id: string) => {
    const next = records.filter((r) => r.id !== id)
    setRecords(next)
    saveHistory(next)
    toast({ title: "已删除", description: "该条记录已移除" })
  }

  const handleClearAll = () => {
    setRecords([])
    saveHistory([])
    toast({ title: "已清空", description: "所有历史记录已清除" })
  }

  return (
    <div className="h-full overflow-y-auto bg-[#fafaf8] dark:bg-slate-950">
      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-10">
        {/* Header */}
        <header className="mb-8">
          <div className="mb-4 h-1 w-12 rounded-full bg-rose-500/60" />
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-[28px] font-bold leading-tight tracking-tight text-slate-900 sm:text-[34px] dark:text-slate-50">
                创作<span className="text-rose-500 dark:text-rose-400">历史</span>
              </h1>
              <p className="mt-2 text-[14px] text-slate-500 dark:text-slate-400">
                最近 14 天的视频创作记录
              </p>
            </div>
            {records.length > 0 && (
              <button
                onClick={handleClearAll}
                className="rounded-xl px-4 py-2 text-[13px] font-medium text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
              >
                清空全部
              </button>
            )}
          </div>
        </header>

        {/* Empty State */}
        {records.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <Film className="h-12 w-12 text-slate-300 dark:text-slate-600" />
            <p className="text-[15px] font-medium text-slate-400">暂无创作记录</p>
            <p className="text-[13px] text-slate-400">回到视频创作，生成你的第一个数字人视频吧</p>
          </div>
        )}

        {/* History List */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {records.map((record) => (
            <div
              key={record.id}
              className={cn(
                "group relative overflow-hidden rounded-2xl border bg-white shadow-sm transition-all hover:shadow-md dark:border-white/10 dark:bg-white/5",
                record.status === "failed" && "border-amber-200/60 dark:border-amber-500/20",
              )}
            >
              {/* Cover / Placeholder */}
              <div className="aspect-[3/4] w-full overflow-hidden bg-slate-100 dark:bg-white/5">
                {record.coverUrl ? (
                  <img
                    src={record.coverUrl}
                    alt="封面图"
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <ImageIcon className="h-10 w-10 text-slate-300 dark:text-slate-600" />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded-md px-2 py-0.5 text-[11px] font-medium",
                      record.status === "success"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
                    )}
                  >
                    {record.status === "success" ? "已完成" : "失败"}
                  </span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-white/10 dark:text-slate-400">
                    {record.gender === "male" ? "男" : "女"}
                  </span>
                </div>

                <p className="mb-1 line-clamp-2 text-[13px] leading-relaxed text-slate-700 dark:text-slate-300">
                  {getExcerpt(record.script)}
                </p>

                <p className="flex items-center gap-1 text-[11px] text-slate-400">
                  <Clock className="h-3 w-3" />
                  {formatTime(record.createdAt)}
                </p>

                {/* Actions */}
                <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-white/5">
                  {record.videoUrl && (
                    <a
                      href={record.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-200 dark:bg-white/10 dark:text-slate-400 dark:hover:bg-white/20"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      查看视频
                    </a>
                  )}
                  {record.coverUrl && (
                    <a
                      href={record.coverUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      download
                      className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-3 py-1.5 text-[12px] font-medium text-rose-600 transition-colors hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20"
                    >
                      <Download className="h-3.5 w-3.5" />
                      下载封面
                    </a>
                  )}
                  <button
                    onClick={() => handleDelete(record.id)}
                    className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
