import { defineComponent, h, type PropType } from 'vue'

const paths = {
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  done: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  terminal: '<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2"/>',
  desktop: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 8h20"/><path d="M6 4v4"/><path d="M10 4v4"/>',
  lounge: '<path d="M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3"/><path d="M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z"/><path d="M4 18v2"/><path d="M20 18v2"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
}

export type IconName = keyof typeof paths

const attrs = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"'

export const iconSvg = (name: IconName, size = 14) => `<svg width="${size}" height="${size}" ${attrs}>${paths[name]}</svg>`

export const Icon = defineComponent({
  props: { name: { type: String as PropType<IconName>, required: true }, size: { type: Number, default: 14 } },
  setup(props) {
    return () => h('span', { class: 'icon', innerHTML: iconSvg(props.name, props.size) })
  },
})
