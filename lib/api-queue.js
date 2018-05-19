const createQueue = require('queue')

module.exports = class ApiQueue {
  constructor ({ request, api } = {}) {
    this.request = request
    this.api = api
    this.queue = createQueue({
      concurrency: 1
    })

    this.manager = this.manager.bind(this)

    this.queue.unshift(this.manager)
    this.queue.autostart = true
  }

  getItems () {
    return this.enqueue(() => this.api.getItems())
  }

  getAllItems () {
    return this.getItems().then(res => this.getAllPages(res))
  }

  getNextPage (response) {
    return this.enqueue(() => this.api.getNextPage(response))
  }

  getItem (id) {
    return this.enqueue(() => this.api.getItem(id))
  }

  getAllPages (response, pages = [response.data]) {
    if (!this.api.hasNextPage(response)) {
      return [].concat(...pages)
    }

    return this.getNextPage(response).then(newResponse =>
      this.getAllPages(newResponse, [...pages, newResponse.data])
    )
  }

  enqueue (apiWrapper) {
    return new Promise((resolve, reject) =>
      this.queue.push(() =>
        apiWrapper()
          .then(resolve)
          .catch(error => {
            if (this.shouldRetry(error)) {
              resolve(this.enqueue(apiWrapper))
            } else {
              reject(error)
            }
          })
      )
    )
  }

  getJobs () {
    return this.queue.jobs
  }

  isRunning () {
    return this.queue.running
  }

  shouldRetry (error) {
    if (error.code === 403 && error.message.includes('rate limit exceeded')) {
      return true
    }

    return false
  }

  manager (cb) {
    return this.api.getRateLimit().then(({ remaining, reset }) => {
      this.queue.splice(remaining, 0, this.manager)

      if (this.queue.jobs.length === 1) {
        this.queue.stop()
        return
      }

      if (remaining === 0) {
        return new Promise(resolve => setTimeout(resolve, reset - Date.now()))
      }
    })
  }
}
