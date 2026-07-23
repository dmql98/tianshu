import { defineStore } from 'pinia'
import { ref } from 'vue'

interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modifiedAt?: number
}

export const useFilesStore = defineStore('files', () => {
  const currentPath = ref('')
  const entries = ref<FileEntry[]>([])
  const loading = ref(false)

  async function fetchEntries(path: string) {
    loading.value = true
    currentPath.value = path
    // 调用 API 获取文件列表
    // const response = await api.get(`/files/list?path=${path}`)
    // entries.value = response.data
    loading.value = false
  }

  async function readFile(path: string) {
    // 调用 API 读取文件内容
    // const response = await api.get(`/files/read?path=${path}`)
    // return response.data
  }

  return {
    currentPath,
    entries,
    loading,
    fetchEntries,
    readFile,
  }
})
