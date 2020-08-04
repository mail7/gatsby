import { reportError, clearError } from "./error-overlay-handler"
import normalizePagePath from "./normalize-page-path"
import { processHotPageDataUpdate } from "./loader"

let socket = null

let staticQueryData = {}
let pageQueryData = {}
let isInitialized = false

export const getStaticQueryData = () => staticQueryData
export const getPageQueryData = () => pageQueryData
export const getIsInitialized = () => isInitialized

export default function socketIo() {
  if (process.env.NODE_ENV !== `production`) {
    if (!socket) {
      // Try to initialize web socket if we didn't do it already
      try {
        // eslint-disable-next-line no-undef
        socket = io()

        const didDataChange = (msg, queryData) => {
          const id =
            msg.type === `staticQueryResult`
              ? msg.payload.id
              : normalizePagePath(msg.payload.id)
          return (
            !(id in queryData) ||
            JSON.stringify(msg.payload.result) !== JSON.stringify(queryData[id])
          )
        }

        socket.on(`message`, msg => {
          let shouldEmit = true
          if (msg.type === `staticQueryResult`) {
            if (msg.payload.result) {
              if (didDataChange(msg, staticQueryData)) {
                const currentEntry = staticQueryData[msg.payload.id]

                // run `processHotPageDataUpdate` if modules changed
                if (
                  !currentEntry ||
                  JSON.stringify(currentEntry.moduleDependencies) !==
                    JSON.stringify(msg.payload.result.moduleDependencies)
                ) {
                  shouldEmit = false
                  processHotPageDataUpdate(msg.payload.result).then(() => {
                    staticQueryData = {
                      ...staticQueryData,
                      [msg.payload.id]: msg.payload.result,
                    }

                    ___emitter.emit(msg.type, msg.payload)
                  })
                } else {
                  staticQueryData = {
                    ...staticQueryData,
                    [msg.payload.id]: msg.payload.result,
                  }
                }
              }
            }
          } else if (msg.type === `pageQueryResult`) {
            if (msg.payload.result) {
              if (didDataChange(msg, pageQueryData)) {
                const currentEntry =
                  pageQueryData[normalizePagePath(msg.payload.id)]

                // run `processHotPageDataUpdate` if modules changed
                if (
                  !currentEntry ||
                  JSON.stringify(currentEntry.moduleDependencies) !==
                    JSON.stringify(msg.payload.result.moduleDependencies)
                ) {
                  shouldEmit = false
                  processHotPageDataUpdate(msg.payload.result).then(() => {
                    pageQueryData = {
                      ...pageQueryData,
                      [normalizePagePath(msg.payload.id)]: msg.payload.result,
                    }

                    ___emitter.emit(msg.type, msg.payload)
                  })
                } else {
                  pageQueryData = {
                    ...pageQueryData,
                    [normalizePagePath(msg.payload.id)]: msg.payload.result,
                  }
                }
              }
            }
          } else if (msg.type === `overlayError`) {
            if (msg.payload.message) {
              reportError(msg.payload.id, msg.payload.message)
            } else {
              clearError(msg.payload.id)
            }
          }
          if (msg.type && msg.payload && shouldEmit) {
            ___emitter.emit(msg.type, msg.payload)
          }
        })
      } catch (err) {
        console.error(`Could not connect to socket.io on dev server.`)
      }
    }
    return socket
  } else {
    return null
  }
}

const inFlightGetPageDataPromiseCache = {}
function getPageData(pathname) {
  pathname = normalizePagePath(pathname)
  if (inFlightGetPageDataPromiseCache[pathname]) {
    return inFlightGetPageDataPromiseCache[pathname]
  } else {
    inFlightGetPageDataPromiseCache[pathname] = new Promise(resolve => {
      if (pageQueryData[pathname]) {
        delete inFlightGetPageDataPromiseCache[pathname]
        resolve(pageQueryData[pathname])
      } else {
        const onPageDataCallback = msg => {
          if (
            msg.type === `pageQueryResult` &&
            normalizePagePath(msg.payload.id) === pathname
          ) {
            socket.off(`message`, onPageDataCallback)
            delete inFlightGetPageDataPromiseCache[pathname]
            resolve(pageQueryData[pathname])
          }
        }
        socket.on(`message`, onPageDataCallback)

        socket.emit(`getDataForPath`, pathname)
      }
    })
  }
  return inFlightGetPageDataPromiseCache[pathname]
}

// Tell websocket-manager.js the new path we're on.
// This will help the backend prioritize queries for this
// path.
function registerPath(path) {
  socket.emit(`registerPath`, path)
}

// Unregister the former path
function unregisterPath(path) {
  socket.emit(`unregisterPath`, path)
}

export { getPageData, registerPath, unregisterPath }
