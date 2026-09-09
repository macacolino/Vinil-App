import { STATUS_LABEL, type AlbumStatus } from '../db/types'

export function StatusBadge({ status }: { status: AlbumStatus }) {
  if (status === 'none') return null
  return <span className={`badge ${status}`}>{STATUS_LABEL[status]}</span>
}
