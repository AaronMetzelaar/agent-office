import { ref, watch } from 'vue'

const key = 'agent-office:terminal'

export const terminalShown = ref(localStorage.getItem(key) === '1')
watch(terminalShown, (shown) => localStorage.setItem(key, shown ? '1' : '0'))
