const expect = require('chai').expect
const ApiQueue = require('./../lib/api-queue')
const Api = require('./../lib/api')
const td = require('testdouble')

describe('Managed API Queue', function () {
  let api
  before(function () {
    api = td.object(new Api())
  })

  it('should add a manager job to the front of the queue', function () {
    const subject = new ApiQueue()
    expect(subject.queue.jobs.length).to.equal(1)
    expect(subject.queue.jobs[0].toString()).to.equal(
      subject.manager.bind(subject).toString()
    )
  })

  it('should pause while waiting for api calls', function () {
    const subject = new ApiQueue()
    expect(subject.queue.running).to.equal(false)
  })

  it('should enqueue and run api calls', function () {
    const subject = new ApiQueue({ api })
    td.when(api.getRateLimit()).thenResolve({ remaining: 999, reset: 0 })
    td.when(api.getItems()).thenResolve('something')
    return subject.getItems().then(res => expect(res).to.equal('something'))
  })

  it('should re-queue manager job when all api calls complete', function () {
    const subject = new ApiQueue({ api })
    td.when(api.getRateLimit()).thenResolve({ remaining: 999, reset: 0 })
    td.when(api.getItems()).thenResolve('something')
    return subject.getItems().then(res => {
      expect(subject.queue.jobs.length).to.equal(1)
      expect(subject.queue.jobs[0].toString()).to.equal(
        subject.manager.bind(subject).toString()
      )
    })
  })

  it('should stop running when all api calls complete', function (done) {
    const subject = new ApiQueue({ api })
    td.when(api.getRateLimit()).thenResolve({ remaining: 999, reset: 0 })
    td.when(api.getItems()).thenResolve('something')
    subject.getItems().then(res => {
      setTimeout(() => {
        expect(subject.queue.running).to.equal(false)
        done()
      }, 100)
    })
  })

  it('should get all pages', function () {
    const subject = new ApiQueue({ api })
    td.when(api.getRateLimit()).thenResolve({ remaining: 999, reset: 0 })

    td.when(api.getItems()).thenResolve({ data: ['one'] })
    td.when(api.hasNextPage({ data: ['one'] })).thenReturn(true)
    td.when(api.getNextPage({ data: ['one'] })).thenResolve({ data: ['two'] })
    td.when(api.hasNextPage({ data: ['two'] })).thenReturn(true)
    td.when(api.getNextPage({ data: ['two'] })).thenResolve({ data: ['three'] })
    td.when(api.getNextPage({ data: ['three'] })).thenReturn(false)

    subject
      .getAllItems()
      .then(items => expect(items).to.deep.equal(['one', 'two', 'three']))
  })

  it('should get all pages even if the rate limit is reached', function (done) {
    const subject = new ApiQueue({ api })
    td
      .when(api.getRateLimit())
      .thenResolve(
        { remaining: 2, reset: 0 },
        { remaining: 0, reset: Date.now() + 1000 },
        { remaining: 999, reset: 0 }
      )

    td.when(api.getItems()).thenResolve({ data: ['one'] })
    td.when(api.hasNextPage({ data: ['one'] })).thenReturn(true)
    td.when(api.getNextPage({ data: ['one'] })).thenResolve({ data: ['two'] })
    td.when(api.hasNextPage({ data: ['two'] })).thenReturn(true)
    td.when(api.getNextPage({ data: ['two'] })).thenResolve({ data: ['three'] })
    td.when(api.hasNextPage({ data: ['three'] })).thenReturn(false)

    subject.getAllItems().then(items => {
      expect(items).to.deep.equal(['one', 'two', 'three'])
      done()
    })
  })

  it('should pause when rate limit is encountered mid-queue', function (done) {
    const subject = new ApiQueue({ api })
    td.when(api.getRateLimit()).thenResolve(
      { remaining: 2, reset: 0 },
      {
        remaining: 0,
        reset: Date.now() + 1000
      },
      { remaining: 2, reset: 0 }
    )
    td.when(api.getItem(1)).thenResolve('one')
    td.when(api.getItem(2)).thenResolve('two')
    td.when(api.getItem(3)).thenResolve('three')

    const results = []

    subject.getItem(1).then(result => results.push(result))
    subject.getItem(2).then(result => results.push(result))
    subject.getItem(3).then(result => results.push(result))

    setTimeout(() => results.push('delay'), 500)

    setTimeout(() => {
      expect(results).to.deep.equal(['one', 'two', 'delay', 'three'])

      done()
    }, 1500)
  })

  it('should pause and restart when there is a gap in requests', done => {
    const subject = new ApiQueue({ api })

    td.when(api.getItem(1)).thenResolve('one')
    td.when(api.getItem(2)).thenResolve('two')
    td.when(api.getItem(3)).thenResolve('three')
    td.when(api.getRateLimit()).thenResolve({ remaining: 9999, reset: 0 })

    const results = []

    subject.getItem(1).then(result => results.push(result))
    subject.getItem(2).then(result => results.push(result))

    setTimeout(() => {
      results.push(`running: ${subject.queue.running}`)
    }, 250)

    setTimeout(() => {
      subject.getItem(3).then(result => results.push(result))
    }, 500)

    setTimeout(() => {
      expect(subject.queue.jobs.length).to.equal(1)
      expect(subject.queue.jobs[0].toString()).to.equal(
        subject.manager.bind(subject).toString()
      )
      expect(subject.queue.running).to.equal(false)
      expect(results).to.deep.equal(['one', 'two', 'running: false', 'three'])

      done()
    }, 1000)
  })

  it('should retry requests that fail due to rate limits', done => {
    const subject = new ApiQueue({ api })

    td.when(api.getItem(1)).thenResolve('one')
    td.when(api.getItem(2)).thenResolve('two')
    td
      .when(api.getItem(2), { times: 1 })
      .thenReject({ message: 'API rate limit exceeded', code: 403 })
    td.when(api.getItem(3)).thenResolve('three')
    td
      .when(api.getRateLimit())
      .thenResolve(
        { remaining: 10, reset: Date.now() + 1000 },
        { remaining: 0, reset: Date.now() + 1000 },
        { remaining: 10, reset: Date.now() + 2000 }
      )

    const results = []

    subject.getItem(1).then(result => results.push(result))
    subject.getItem(2).then(result => results.push(result))
    subject.getItem(3).then(result => results.push(result))

    setTimeout(() => {
      expect(results).to.deep.equal(['one', 'three', 'two'])
      done()
    }, 1500)
  })
})
