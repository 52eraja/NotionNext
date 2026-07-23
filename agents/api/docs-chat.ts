import { createGoogle } from '@ai-sdk/google'
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage
} from 'ai'

type Env = {
  GOOGLE_GENERATIVE_AI_API_KEY?: string
  DOCS_CHAT_MODEL?: string
  DOCS_CHAT_CORS_ORIGINS?: string
  DOCS_CHAT_MAX_TOKENS?: string
}

type ChatRequestBody = {
  messages?: UIMessage[]
  system?: string
}

const DEFAULT_MODEL = 'gemini-2.5-flash'
const DEFAULT_MAX_TOKENS = 1200

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init.headers
    }
  })

const corsHeaders = (request: Request, env: Env) => {
  const origin = request.headers.get('origin')
  const allowed = env.DOCS_CHAT_CORS_ORIGINS?.split(',')
    .map(item => item.trim())
    .filter(Boolean)

  if (!origin || !allowed?.length) {
    return {}
  }

  if (!allowed.includes('*') && !allowed.includes(origin)) {
    return {}
  }

  return {
    'access-control-allow-origin': allowed.includes('*') ? '*' : origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type'
  }
}

const maxOutputTokens = (value: string | undefined) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_TOKENS
}

// EdgeOne Makers Agent Runtime handler for docs-chat
export async function onRequest(context: {
  request: Request
  env: Env
  store?: unknown
  signal?: AbortSignal
}) {
  const { request, env } = context
  const method = request.method

  const headers = corsHeaders(request, env)

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers
    })
  }

  if (method !== 'POST') {
    return json({ error: 'Method not allowed.' }, { status: 405, headers })
  }

  if (!env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return json(
      { error: 'Missing GOOGLE_GENERATIVE_AI_API_KEY environment variable.' },
      { status: 500, headers }
    )
  }

  const { messages = [], system = '' } = (await request.json()) as ChatRequestBody
  const google = createGoogle({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })
  const result = streamText({
    model: google(env.DOCS_CHAT_MODEL || DEFAULT_MODEL),
    messages: await convertToModelMessages(messages),
    system,
    maxOutputTokens: maxOutputTokens(env.DOCS_CHAT_MAX_TOKENS)
  })

  const stream = createUIMessageStream<UIMessage>({
    execute: ({ writer }) => {
      writer.merge(toUIMessageStream({ stream: result.stream }))
    },
    onError: error => {
      console.error(error)
      return 'AI assistant request failed.'
    }
  })

  return createUIMessageStreamResponse({
    headers: {
      ...headers,
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no'
    },
    stream
  })
}
