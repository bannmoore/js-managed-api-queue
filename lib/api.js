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

  getRateLimit () {
    return this.request.get('/rate/limit')
  }
}
