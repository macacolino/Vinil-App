import { Link } from 'react-router-dom'
import { cancelJob, dismissJob, enqueueImport, enqueuePrices, enqueueTracks, useJobs, type Job } from '../lib/jobs'

function text(job: Job) {
  const name = <Link to={`/artistas/${job.artistId}`}>{job.label}</Link>
  if (job.kind === 'import') {
    switch (job.status) {
      case 'queued':
        return <>Na fila: discografia de {name}</>
      case 'running':
        return <>Importando discografia de {name}{job.detail ? ` · ${job.detail}` : '…'}</>
      case 'done': {
        const r = job.result
        if (!r) return <>Discografia de {name} pronta.</>
        const parts = [`${r.total} álbuns`]
        if (r.added) parts.push(`${r.added} novos`)
        if (r.removed) parts.push(`${r.removed} removidos`)
        return <>Discografia de {name}: {parts.join(', ')}.{r.usedFallback ? ' Sem dados de vinil no MusicBrainz; lista completa usada.' : ''}</>
      }
      case 'cancelled':
        return <>Importação de {name} cancelada.</>
      case 'error':
        return <>Falha ao importar {name}: {job.error}</>
    }
  }
  if (job.kind === 'prices') {
    switch (job.status) {
      case 'queued':
        return <>Na fila: preços de {name}</>
      case 'running':
        return <>Consultando preços no Discogs para {name}{job.total ? ` · ${job.done} de ${job.total}` : '…'}</>
      case 'done':
        return <>Preços e raridade de {job.label} atualizados ({job.total}).</>
      case 'cancelled':
        return <>Consulta de preços de {name} parada em {job.done} de {job.total}.</>
      case 'error':
        return <>Falha nos preços de {name}: {job.error}</>
    }
  }
  switch (job.status) {
    case 'queued':
      return <>Na fila: faixas de {name}</>
    case 'running':
      return <>Buscando faixas de {name}{job.total ? ` · ${job.done} de ${job.total}` : '…'}</>
    case 'done':
      return <>Faixas de {job.label} prontas ({job.total}).</>
    case 'cancelled':
      return <>Busca de faixas de {name} parada em {job.done} de {job.total}.</>
    case 'error':
      return <>Falha nas faixas de {name}: {job.error}</>
  }
}

function retry(job: Job) {
  dismissJob(job.id)
  if (job.kind === 'import') enqueueImport(job.artistId, job.label, job.prune)
  else if (job.kind === 'prices') enqueuePrices(job.artistId, job.label)
  else enqueueTracks(job.artistId, job.label)
}

/** Barra fixa acima do menu: mostra o que está rodando em segundo plano. */
export function JobsBar() {
  const jobs = useJobs()
  if (jobs.length === 0) return null
  return (
    <div className="jobs-bar">
      {jobs.map((job) => {
        const active = job.status === 'running' || job.status === 'queued'
        return (
          <div key={job.id} className={`job job-${job.status}`}>
            {active && <span className="spinner" />}
            <div className="grow">
              <div className="job-text">{text(job)}</div>
              {job.kind !== 'import' && job.status === 'running' && job.total > 0 && (
                <div className="progress">
                  <div style={{ width: `${(job.done / job.total) * 100}%` }} />
                </div>
              )}
            </div>
            {active ? (
              <button className="btn ghost small" onClick={() => cancelJob(job.id)}>Parar</button>
            ) : (
              <>
                {(job.status === 'error' || job.status === 'cancelled') && (
                  <button className="btn small" onClick={() => retry(job)}>Continuar</button>
                )}
                <button className="btn ghost small" onClick={() => dismissJob(job.id)} aria-label="Fechar">✕</button>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
