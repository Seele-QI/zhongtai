"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { LogOut, LogIn, ChevronUp, Coins, Loader2 } from "lucide-react"
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

type Me = { user: { id: number; phone_masked: string }; balance: number } | null

export function UserMenu() {
  const router = useRouter()
  const [me, setMe] = useState<Me | undefined>(undefined)
  const [openLogin, setOpenLogin] = useState(false)
  const [openMenu, setOpenMenu] = useState(false)
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [cooldown, setCooldown] = useState(0)
  const [submitting, setSubmitting] = useState(false)

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

  const sendCode = async () => {
    if (!/^1\d{10}$/.test(phone)) {
      toast.error("请输入 11 位手机号")
      return
    }
    try {
      const r = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone }),
        credentials: "include",
      })
      if (r.ok) {
        setCooldown(60)
        toast.success("验证码已发送（dev 模式请查 FastAPI 日志）")
      } else {
        toast.error("发送失败，请稍后再试")
      }
    } catch {
      toast.error("网络错误")
    }
  }

  const onLogin = async () => {
    if (!/^1\d{10}$/.test(phone) || !/^\d{6}$/.test(code)) {
      toast.error("请输入手机号与 6 位验证码")
      return
    }
    setSubmitting(true)
    try {
      const r = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, code }),
        credentials: "include",
      })
      if (r.ok) {
        toast.success("登录成功，赠送 100 积分")
        setOpenLogin(false)
        setPhone("")
        setCode("")
        await refresh()
        setOpenMenu(false)
        router.refresh()
      } else {
        const err = (await r.json().catch(() => null)) as { detail?: { message?: string } } | null
        toast.error(err?.detail?.message ?? "登录失败")
      }
    } catch {
      toast.error("网络错误")
    } finally {
      setSubmitting(false)
    }
  }

  const onLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
    } catch {
      // 忽略错误——本地清空状态即可
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
        <Dialog open={openLogin} onOpenChange={setOpenLogin}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>手机号登录</DialogTitle>
              <DialogDescription>未注册账号登录后自动创建，并赠送 100 积分。</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="um-phone">手机号</Label>
                <Input
                  id="um-phone"
                  inputMode="numeric"
                  maxLength={11}
                  placeholder="13800000000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="um-code">验证码</Label>
                <div className="flex gap-2">
                  <Input
                    id="um-code"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="6 位数字"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={cooldown > 0}
                    onClick={sendCode}
                  >
                    {cooldown > 0 ? `${cooldown}s` : "获取验证码"}
                  </Button>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={onLogin} disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "登录"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  // 已登录：手机号末 2 位做头像
  const avatar = me.user.phone_masked.slice(-2)
  return (
    <div className="m-3" data-user-menu>
      <button
        type="button"
        onClick={() => setOpenMenu((o) => !o)}
        className="flex w-full items-center gap-3 rounded-xl border border-sidebar-border bg-card p-3 text-left transition-colors hover:bg-accent/40 soft-shadow"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {avatar}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{me.user.phone_masked}</p>
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
