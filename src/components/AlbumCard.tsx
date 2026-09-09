import { Link } from 'react-router-dom'
import { ALBUM_TYPE_LABEL, type Album } from '../db/types'
import { Cover } from './Cover'
import { StatusBadge } from './StatusBadge'

export function AlbumCard({ album, showType = false }: { album: Album; showType?: boolean }) {
  return (
    <Link to={`/albuns/${album.id}`} className="album-card">
      <Cover src={album.coverUrl} alt={album.title} />
      <div className="badge-wrap">
        <StatusBadge status={album.status} />
      </div>
      <div className="title">{album.title}</div>
      <div className="meta">
        {album.year}
        {showType ? ` · ${ALBUM_TYPE_LABEL[album.type]}` : ''}
      </div>
    </Link>
  )
}
