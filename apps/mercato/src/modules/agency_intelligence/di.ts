import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { PipeboardClient } from './lib/pipeboard-client'

export function register(container: AppContainer) {
  container.register({
    pipeboardClient: asFunction(() =>
      new PipeboardClient({ apiKey: process.env.PIPEBOARD_API_KEY ?? '' }),
    ).scoped().proxy(),
  })
}
