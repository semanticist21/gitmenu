// Both windows load index.html: the panel at `#/`, the detail window at `#/detail/…`.
import { createHashHistory, createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router'
import { DetailApp } from './detail/DetailApp'
import { PanelApp } from './panel/PanelApp'

const rootRoute = createRootRoute({ component: Outlet })

const panelRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: PanelApp })

const detailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/detail/$', component: DetailApp })

export const router = createRouter({
  routeTree: rootRoute.addChildren([panelRoute, detailRoute]),
  history: createHashHistory(),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
