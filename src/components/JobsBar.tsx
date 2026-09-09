import { Link } from 'react-router-dom'
import { cancelJob, dismissJob, enqueueTracks, useJobs } from '../lib/jobs'

/** Barra fixa acima do menu: mostra o que está rodando em segundo plano. */
export function JobsBar() {
  const jobs = useJobs()
  if (jobs.length === 0) return null
  return (
    <div className="jobs-bar">
      {jobs.map((job) => (
        <div key={job.id} className={`job job-${job.status}`}>
          {job.status === 'running' || job.status === 'queued' ? <span className="spinner" /> : null}
          <div className="grow">
            <div className="job-text">
              {job.status === 'queued' && <>Na fila: faixas de <Link to={`/artistas/${job.artistId}`}>{job.label}</Link></>}
              {job.status === 'running' && (
                <>
                  Buscando faixas de <Link to={`/artistas/${job.artistId}`}>{job.label}</Link>
                  {job.total ? ` · ${job.done} de ${job.total}` : '…'}
                </>
              )}
              {job.status === 'done' && <>Faixas de {job.label} prontas ({job.total}).</>}
              {job.status === 'cancelled' && <>Busca de {job.label} parada em {job.done} de {job.total}.</>}
              {job.status === 'error' && <>Falha em {job.label}: {job.error}</>}
            </div>
            {job.status === 'running' && job.total > 0 && (
              <div className="progress">
                <div style={{ width: `${(job.done / job.total) * 100}%` }} />
              </div>
            )}
          </div>
          {job.status === 'running' || job.status === 'queued' ? (
            <button className="btn ghost small" onClick={() => cancelJob(job.id)}>Parar</button>
          ) : job.status === 'error' || job.status === 'cancelled' ? (
            <>
              <button className="btn small" onClick={() => { dismissJob(job.id); enqueueTracks(job.artistId, job.label) }}>
                Continuar
              </button>
              <button className="btn ghost small" onClick={() => dismissJob(job.id)} aria-label="Fechar">✕</button>
            </>
          ) : (
            <button className="btn ghost small" onClick={() => dismissJob(job.id)} aria-label="Fechar">✕</button>
          )}
        </div>
      ))}
    </div>
  )
}
