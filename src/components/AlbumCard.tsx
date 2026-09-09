import { Link } from 'react-router-dom'
import { ALBUM_TYPE_LABEL, type Album } from '../db/types'
import { Cover, cardSources } from './Cover'
import { Rarity } from './Rarity'
import { StatusBadge } from './StatusBadge'

export function AlbumCard({ album, showType = false }: { album: Album; showType?: boolean }) {
  return (
    <Link to={`/albuns/${album.id}`} className="album-card">
      <Cover sources={cardSources(album)} alt={album.title} />
      <StatusBadge status={album.status} />
      <div className="title">{album.title}</div>
      <div className="meta">
        <span>
          {album.year || 's/ ano'}
          {showType ? ` · ${ALBUM_TYPE_LABEL[album.type]}` : ''}
        </span>
        <Rarity value={album.rarity} size="small" />
      </div>
    </Link>
  )
}
