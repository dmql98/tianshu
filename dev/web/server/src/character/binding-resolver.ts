import { createHash } from 'crypto'
import { characterRevisionStore, type CharacterRevisionRow } from './revision-store.js'

export interface CharacterBinding {
  character_id: string
  character_binding_mode?: 'follow_latest' | 'pinned'
  pinned_character_revision_id?: string | null
}

export interface ResolvedCharacterBinding {
  characterId: string
  revision: CharacterRevisionRow
  snapshotHash: string
}

export function resolveCharacterBinding(binding: CharacterBinding): ResolvedCharacterBinding {
  let revision: CharacterRevisionRow | null = null
  if (binding.character_binding_mode === 'pinned' && binding.pinned_character_revision_id) {
    revision = characterRevisionStore.getRevision(binding.pinned_character_revision_id)
    if (!revision || revision.character_id !== binding.character_id) {
      throw new Error('Pinned character revision is missing or belongs to another character')
    }
  } else {
    revision = characterRevisionStore.ensureCurrent(binding.character_id)
  }
  return {
    characterId: binding.character_id,
    revision,
    snapshotHash: createHash('sha256').update(revision.snapshot).digest('hex'),
  }
}

