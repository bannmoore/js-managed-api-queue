module.exports = class Api {
  constructor ({ request } = {}) {
    this.request = request
  }

  getItems () {
    return this.request.get('/some/url')
  }

  getItem (id) {
    return this.request.get(`/some/url/${id}`)
  }

  getNextPage (response) {
    return this.request.get(`/next/page`)
  }

  hasNextPage (response) {
    return true
  }

  getRateLimit () {
    return this.request.get('/rate/limit')
  }
}
