<script lang="ts">
  import { encode } from 'uqr'

  let { value, label }: { value: string; label: string } = $props()

  // Dark modules as one path; a quiet zone of 2 modules keeps phone scanners reliable.
  const qr = $derived(encode(value, { border: 2 }))
  const path = $derived(
    qr.data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : []))).join(''),
  )
</script>

<svg
  role="img"
  aria-label={label}
  viewBox="0 0 {qr.size} {qr.size}"
  shape-rendering="crispEdges"
  class="size-56 rounded-md bg-white p-1"
>
  <path d={path} fill="black" />
</svg>
