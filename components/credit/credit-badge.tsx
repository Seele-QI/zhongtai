"use client"

import { useEffect, useState } from "react"
import { Coins, Loader2 } from "lucide-react"
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

export function CreditBadge() {
  const [me, setMe] = useState<Me>(undefined as unknown as Me)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [cooldown, setCooldown] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/auth/me", { credentials: "include" })
      if (r.status === 401) {
        setMe(null)
      } else if (r.ok) {
        const data = (await r.json()) as Me
        setMe(data)
      }
    } catch {
      setMe(null)
    } finally {
      setLoading(false)
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
        setOpen(false)
        setPhone("")
        setCode("")
        await refresh()
        window.location.reload()
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

  if (me === undefined) {
    return (
      <div className="flex h-9 w-24 items-center justify-center text-xs text-muted-foreground">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      </div>
    )
  }

  if (me === null) {
    return (
      <>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          登录
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>手机号登录</DialogTitle>
              <DialogDescription>未注册账号登录后自动创建，并赠送 100 积分。</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="phone">手机号</Label>
                <Input
                  id="phone"
                  inputMode="numeric"
                  maxLength={11}
                  placeholder="13800000000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="code">验证码</Label>
                <div className="flex gap-2">
                  <Input
                    id="code"
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

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-3 py-1 text-sm">
      <Coins className="h-3.5 w-3.5 text-amber-500" />
      <span className="font-medium tabular-nums">{me.balance}</span>
      <span className="text-xs text-muted-foreground">积分</span>
    </div>
  )
}
