<script lang="ts">
  import { onDestroy } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import { Spinner } from '$lib/components/ui/spinner'
  import * as Alert from '$lib/components/ui/alert'
  import QrCode from './QrCode.svelte'
  import type { FlowStatus, QrFlow } from '$lib/api'

  let {
    label,
    scanHint,
    begin,
    poll,
    ondone,
  }: {
    label: string
    scanHint: string
    begin: () => Promise<QrFlow>
    poll: (id: string) => Promise<FlowStatus>
    ondone: () => void
  } = $props()

  const POLL_MS = 3000

  let flow = $state<QrFlow | null>(null)
  let starting = $state(false)
  let error = $state<string | null>(null)
  let timer: ReturnType<typeof setInterval> | undefined

  function stop(): void {
    clearInterval(timer)
    timer = undefined
  }

  async function start(): Promise<void> {
    stop()
    error = null
    starting = true
    try {
      flow = await begin()
      const id = flow.id
      timer = setInterval(async () => {
        try {
          const result = await poll(id)
          if (result.status === 'done') {
            stop()
            flow = null
            ondone()
          } else if (result.status === 'failed') {
            stop()
            flow = null
            error = result.message
          }
        } catch (cause) {
          stop()
          flow = null
          error = cause instanceof Error ? cause.message : '连接失败'
        }
      }, POLL_MS)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : '连接失败'
    } finally {
      starting = false
    }
  }

  onDestroy(stop)
</script>

<div class="flex flex-col gap-3">
  {#if flow}
    <div class="flex flex-col items-start gap-2">
      <QrCode value={flow.url} label="{label}二维码" />
      <p class="text-sm text-muted-foreground" role="status" aria-live="polite">{scanHint}</p>
      <div class="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" href={flow.url} target="_blank" rel="noreferrer">在本机打开</Button>
        <Button variant="ghost" size="sm" onclick={() => { stop(); flow = null }}>取消</Button>
      </div>
    </div>
  {:else}
    <div>
      <Button onclick={start} disabled={starting}>
        {#if starting}<Spinner data-icon="inline-start" />{/if}
        {label}
      </Button>
    </div>
  {/if}
  {#if error}
    <Alert.Root variant="destructive">
      <Alert.Title>没有连上</Alert.Title>
      <Alert.Description>{error}</Alert.Description>
    </Alert.Root>
  {/if}
</div>
