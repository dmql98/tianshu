import { apiGet } from './client'
import type { Event } from '@/types'

export const fetchEvents = () => apiGet<Event[]>('/api/events')
