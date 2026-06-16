"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { LogOut, LogIn, ChevronUp, Coins, Loader2, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"

type Me = { user: { id: number; email_masked: string }; balance: number } | null

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function UserMenu() {
  const router = useRouter()
  const [me, setMe] = useState<Me | undefined>(undefined)
  const [openLogin, setOpenLogin] = useState(false)
  const [openMenu, setOpenMenu] = useState(false)
  const [email, setEmail] = useState("")
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  const refresh = async () => {
    try {
      const r = await fetch("/api/auth/me", { credentials: "include" })
      if (r.status === 401) {
        setMe(null)
      } else if (r.ok) {
        setMe((await r.json()) as Me)
      } else {
        setMe(null)
      }
    } catch {
      setMe(null)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  useEffect(() => {
    if (!openMenu) return
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest("[data-user-menu]")) setOpenMenu(false)
    }
    document.addEventListener("click", close)
    return () => document.removeEventListener("click", close)
  }, [openMenu])

  const sendLink = async () => {
    if (!EMAIL_RE.test(email)) {
      toast.error("请输入有效邮箱地址")
      return
    }
    setSending(true)
    try {
      const r = await fetch("/api/auth/send-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
        credentials: "include",
      })
      if (r.ok) {
        setSent(true)
        setCooldown(60)
        toast.success("登录链接已发送到你的邮箱")
      } else {
        toast.error("发送失败，请稍后再试")
      }
    } catch {
      toast.error("网络错误")
    } finally {
      setSending(false)
    }
  }

  const onLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
    } catch {
      // ignore
    }
    setMe(null)
    setOpenMenu(false)
    toast.success("已退出登录")
    router.refresh()
  }

  if (me === undefined) {
    return (
      <div className="m-3 rounded-xl border border-sidebar-border bg-card p-3 soft-shadow">
        <div className="flex h-9 items-center gap-3 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>加载中…</span>
        </div>
      </div>
    )
  }

  if (me === null) {
    return (
      <>
        <div className="m-3" data-user-menu>
          <Button
            variant="outline"
            className="w-full justify-center gap-2"
            size="sm"
            onClick={() => setOpenLogin(true)}
          >
            <LogIn className="h-4 w-4" />
            登录 / 注册
          </Button>
        </div>
        <Dialog
          open={openLogin}
          onOpenChange={(o) => {
            setOpenLogin(o)
            if (!o) {
              setSent(false)
              setEmail("")
              setCooldown(0)
            }
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>邮箱登录</DialogTitle>
              <DialogDescription>未注册账号登录后自动创建，并赠送 100 积分。</DialogDescription>
            </DialogHeader>
            {sent ? (
              <div className="space-y-3 py-4 text-center">
                <Mail className="mx-auto h-10 w-10 text-primary" />
                <p className="text-sm">
                  登录链接已发送到 <span className="font-mono">{email}</span>
                </p>
                <p className="text-xs text-muted-foreground">15 分钟内有效。点击邮件中的链接即可登录。</p>
                <Button variant="outline" size="sm" disabled={cooldown > 0} onClick={sendLink}>
                  {cooldown > 0 ? `${cooldown}s 后重发` : "重新发送"}
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label htmlFor="um-email">邮箱</Label>
                    <Input
                      id="um-email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={sendLink} disabled={sending}>
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "发送登录链接"}
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </>
    )
  }

  // 已登录：邮箱 @ 前 1 + 末 1 做头像
  const local = me.user.email_masked.split("@")[0]
  const avatar = (local[0] || "?") + (local.slice(-1) || "")
  return (
    <div className="m-3" data-user-menu>
      <button
        type="button"
        onClick={() => setOpenMenu((o) => !o)}
        className="flex w-full items-center gap-3 rounded-xl border border-sidebar-border bg-card p-3 text-left transition-colors hover:bg-accent/40 soft-shadow"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {avatar.toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{me.user.email_masked}</p>
          <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            <Coins className="h-3 w-3 text-amber-500" />
            <span className="tabular-nums">{me.balance}</span>
            <span>积分</span>
          </p>
        </div>
        <ChevronUp
          className={`h-4 w-4 text-muted-foreground transition-transform ${openMenu ? "" : "rotate-180"}`}
        />
      </button>

      {openMenu && (
        <div className="mt-2 rounded-xl border border-sidebar-border bg-card p-2 soft-shadow">
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
          >
            <LogOut className="h-4 w-4" />
            退出登录
          </button>
        </div>
      )}
    </div>
  )
}