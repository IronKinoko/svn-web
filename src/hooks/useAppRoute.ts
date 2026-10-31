import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import {
  parseAppRoute,
  serializeAppRoute,
  type AppRoute,
} from '../lib/appRoute'

type NavigateOptions = {
  replace?: boolean
}

export function useAppRoute() {
  const location = useLocation()
  const params = useParams()
  const routerNavigate = useNavigate()
  const locationIdParam = params.locationId
  const viewParam = params.view
  const pathParam = params['*']
  const route = useMemo(
    () =>
      parseAppRoute(
        locationIdParam,
        viewParam,
        pathParam,
        location.search,
      ),
    [location.search, locationIdParam, pathParam, viewParam],
  )
  const canonicalPath = serializeAppRoute(route)
  const navigate = useCallback(
    (nextRoute: AppRoute, options: NavigateOptions = {}) => {
      void routerNavigate(serializeAppRoute(nextRoute), {
        replace: options.replace,
      })
    },
    [routerNavigate],
  )

  return {
    route,
    navigate,
    isCanonical:
      `${location.pathname}${location.search}` === canonicalPath,
  }
}
