import { NextRequest, NextResponse } from 'next/server'
import { checkStrIsNotionId, getLastPartOfUrl } from '@/lib/utils'
import { idToUuid } from 'notion-utils'
import BLOG from './blog.config'

/**
 * Clerk 身份验证中间件
 */
export const config = {
  // 这里设置白名单，防止静态资源被拦截
  matcher: ['/((?!.*\\..*|_next|/sign-in|/auth).*)', '/', '/(api|trpc)(.*)']
}

/**
 * 没有配置权限相关功能的返回
 * @param req
 * @param ev
 * @returns
 */
// eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
const noAuthMiddleware = async (req: NextRequest, ev: any) => {
  // 如果没有配置 Clerk 相关环境变量，返回一个默认响应或者继续处理请求
  if (BLOG['UUID_REDIRECT']) {
    let redirectJson: Record<string, string> = {}
    try {
      const response = await fetch(`${req.nextUrl.origin}/redirect.json`)
      if (response.ok) {
        redirectJson = (await response.json()) as Record<string, string>
      }
    } catch (err) {
      console.error('Error fetching static file:', err)
    }
    let lastPart = getLastPartOfUrl(req.nextUrl.pathname) as string
    if (checkStrIsNotionId(lastPart)) {
      lastPart = idToUuid(lastPart)
    }
    if (lastPart && redirectJson[lastPart]) {
      const redirectToUrl = req.nextUrl.clone()
      redirectToUrl.pathname = '/' + redirectJson[lastPart]
      console.log(
        `redirect from ${req.nextUrl.pathname} to ${redirectToUrl.pathname}`
      )
      return NextResponse.redirect(redirectToUrl, 308)
    }
  }
  return NextResponse.next()
}

// 动态导入 Clerk，避免在没有 Clerk 配置时顶层静态导入导致构建/运行时失败
let clerkMiddleware: any = null
let createRouteMatcher: any = null
if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const clerk = require('@clerk/nextjs/server')
    clerkMiddleware = clerk.clerkMiddleware
    createRouteMatcher = clerk.createRouteMatcher
  } catch {
    // Clerk 包不可用时忽略，将走 noAuthMiddleware 分支
  }
}

// 限制登录访问的路由
const isTenantRoute = createRouteMatcher
  ? createRouteMatcher([
      '/user/organization-selector(.*)',
      '/user/orgid/(.*)',
      '/dashboard',
      '/dashboard/(.*)'
    ])
  : () => false

// 限制权限访问的路由
const isTenantAdminRoute = createRouteMatcher
  ? createRouteMatcher(['/admin/(.*)/memberships', '/admin/(.*)/domain'])
  : () => false

/**
 * 鉴权中间件
 */
const authMiddleware = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && clerkMiddleware
  ? clerkMiddleware((auth: any, req: NextRequest) => {
      const { userId } = auth()
      // 处理 /dashboard 路由的登录保护
      if (isTenantRoute(req)) {
        if (!userId) {
          // 用户未登录，重定向到 /sign-in
          const url = new URL('/sign-in', req.url)
          url.searchParams.set('redirectTo', req.url) // 保存重定向目标
          return NextResponse.redirect(url)
        }
      }

      // 处理管理员相关权限保护
      if (isTenantAdminRoute(req)) {
        auth().protect((has: any) => {
          return (
            has({ permission: 'org:sys_memberships:manage' }) ||
            has({ permission: 'org:sys_domains_manage' })
          )
        })
      }

      // 默认继续处理请求
      return NextResponse.next()
    })
  : noAuthMiddleware

export default authMiddleware
