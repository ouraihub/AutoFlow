<script lang="ts">
  import * as Card from '$lib/components/ui/card'
  import * as Field from '$lib/components/ui/field'
  import * as Alert from '$lib/components/ui/alert'
  import { Badge } from '$lib/components/ui/badge'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Spinner } from '$lib/components/ui/spinner'
  import QrFlow from '$lib/components/QrFlow.svelte'
  import { api, ApiError, type ConnectState } from '$lib/api'

  type View = { kind: 'loading' } | { kind: 'login' } | { kind: 'ready'; state: ConnectState } | { kind: 'error'; message: string }

  let view = $state<View>({ kind: 'loading' })
  let adminToken = $state('')
  let botToken = $state('')
  let busy = $state<string | null>(null)
  let formError = $state<string | null>(null)

  async function load(): Promise<void> {
    try {
      view = { kind: 'ready', state: await api.state() }
    } catch (cause) {
      view = cause instanceof ApiError && cause.status === 401 ? { kind: 'login' } : { kind: 'error', message: messageOf(cause) }
    }
  }

  function messageOf(cause: unknown): string {
    return cause instanceof Error ? cause.message : '请求失败'
  }

  async function run(action: string, task: () => Promise<unknown>): Promise<void> {
    busy = action
    formError = null
    try {
      await task()
      await load()
    } catch (cause) {
      formError = messageOf(cause)
    } finally {
      busy = null
    }
  }

  void load()
</script>

<main class="mx-auto flex max-w-xl flex-col gap-6 px-4 py-10">
  <header class="flex flex-col gap-1">
    <h1 class="text-2xl font-semibold tracking-tight">AutoFlow 连接</h1>
    <p class="text-sm text-muted-foreground">连好飞书或电报后，直接给机器人发需求，它会在 GitHub 上建任务并回报进度。</p>
  </header>

  {#if view.kind === 'loading'}
    <div class="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> 加载中</div>
  {:else if view.kind === 'error'}
    <Alert.Root variant="destructive">
      <Alert.Title>页面加载失败</Alert.Title>
      <Alert.Description>{view.message}</Alert.Description>
    </Alert.Root>
  {:else if view.kind === 'login'}
    <Card.Root>
      <Card.Header>
        <Card.Title>登录</Card.Title>
        <Card.Description>输入部署时设置的管理口令。</Card.Description>
      </Card.Header>
      <Card.Content>
        <form onsubmit={(event) => { event.preventDefault(); void run('login', () => api.login(adminToken)) }}>
          <Field.FieldGroup>
            <Field.Field data-invalid={formError ? true : undefined}>
              <Field.FieldLabel for="admin-token">管理口令</Field.FieldLabel>
              <Input id="admin-token" type="password" autocomplete="current-password" required bind:value={adminToken} aria-invalid={formError ? true : undefined} />
              {#if formError}<Field.FieldError>{formError}</Field.FieldError>{/if}
            </Field.Field>
            <Field.Field orientation="horizontal">
              <Button type="submit" disabled={busy === 'login'}>
                {#if busy === 'login'}<Spinner data-icon="inline-start" />{/if}
                登录
              </Button>
            </Field.Field>
          </Field.FieldGroup>
        </form>
      </Card.Content>
    </Card.Root>
  {:else}
    {@const { feishu, telegram } = view.state}
    <Card.Root>
      <Card.Header>
        <Card.Title class="flex items-center gap-2">飞书 {#if feishu.connected}<Badge variant="secondary">已连接</Badge>{/if}</Card.Title>
        <Card.Description>
          {feishu.connected ? '在飞书里给机器人发消息即可下需求，约一分钟内处理。' : '用手机飞书扫码，确认后会自动创建机器人并连接到你，不需要进开发者后台。'}
        </Card.Description>
      </Card.Header>
      <Card.Content>
        {#if feishu.connected}
          <Button variant="outline" disabled={busy === 'feishu'} onclick={() => run('feishu', () => api.disconnect('feishu'))}>断开飞书</Button>
        {:else}
          <QrFlow label="扫码连接飞书" scanHint="用手机飞书扫码并确认创建应用，完成后这里会自动刷新。" begin={api.feishuBegin} poll={api.feishuPoll} ondone={load} />
        {/if}
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title class="flex items-center gap-2">
          电报
          {#if telegram.configured}<Badge variant="secondary">@{telegram.username}</Badge>{/if}
        </Card.Title>
        <Card.Description>
          {#if !telegram.configured}
            电报的机器人只能由 @BotFather 创建：发送 /newbot，把它给的 token 粘贴到下面，只需要一次。
          {:else if telegram.boundUsers === 0}
            机器人已就绪。扫码打开机器人并点"开始"，即可绑定你的电报账号。
          {:else}
            已绑定 {telegram.boundUsers} 个电报账号，直接给机器人发需求即可。
          {/if}
        </Card.Description>
      </Card.Header>
      <Card.Content class="flex flex-col gap-4">
        {#if !telegram.configured}
          <form onsubmit={(event) => { event.preventDefault(); void run('telegram-token', () => api.telegramToken(botToken)) }}>
            <Field.FieldGroup>
              <Field.Field data-invalid={formError ? true : undefined}>
                <Field.FieldLabel for="bot-token">Bot token</Field.FieldLabel>
                <Input id="bot-token" type="password" autocomplete="off" required bind:value={botToken} aria-invalid={formError ? true : undefined} />
                <Field.FieldDescription>保存时会验证 token，并把机器人的消息转到这个网站。</Field.FieldDescription>
                {#if formError}<Field.FieldError>{formError}</Field.FieldError>{/if}
              </Field.Field>
              <Field.Field orientation="horizontal">
                <Button type="submit" disabled={busy === 'telegram-token'}>
                  {#if busy === 'telegram-token'}<Spinner data-icon="inline-start" />{/if}
                  保存
                </Button>
              </Field.Field>
            </Field.FieldGroup>
          </form>
        {:else}
          <QrFlow label="扫码绑定电报" scanHint="用手机扫码打开机器人，点「开始」，完成后这里会自动刷新。" begin={api.telegramBind} poll={api.telegramPoll} ondone={load} />
          <div>
            <Button variant="outline" disabled={busy === 'telegram'} onclick={() => run('telegram', () => api.disconnect('telegram'))}>断开电报</Button>
          </div>
        {/if}
      </Card.Content>
    </Card.Root>

    {#if formError}
      <Alert.Root variant="destructive">
        <Alert.Title>操作失败</Alert.Title>
        <Alert.Description>{formError}</Alert.Description>
      </Alert.Root>
    {/if}
  {/if}
</main>
