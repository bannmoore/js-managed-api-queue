const expect = require('chai').expect
const ApiQueue = require('./../lib/api-queue')
const td = require('testdouble')

describe('Managed API Queue', function () {
  it('should add a manager job to the front of the queue', function () {
    const subject = new ApiQueue()
    const jobs = subject.getJobs()
    expect(jobs.length).to.equal(1)
    expect(jobs[0].toString()).to.equal(subject.manager.toString())
  })

  it('should pause while waiting for api calls', function () {
    const subject = new ApiQueue()
    expect(subject.isRunning()).to.equal(false)
  })

  it('should enqueue and run api calls', function () {
    const request = td.object(['get'])
    const subject = new ApiQueue({ request })
    td
      .when(request.get('/rate/limit'))
      .thenResolve({ remaining: 999, reset: 0 })
    td.when(request.get('/some/url')).thenResolve('something')
    return subject.getItems().then(res => expect(res).to.equal('something'))
  })

  it('should re-queue manager job when all api calls complete', function () {
    const request = td.object(['get'])
    const subject = new ApiQueue({ request })
    td
      .when(request.get('/rate/limit'))
      .thenResolve({ remaining: 999, reset: 0 })
    td.when(request.get('/some/url')).thenResolve('something')
    return subject.getItems().then(res => {
      const jobs = subject.getJobs()
      expect(jobs.length).to.equal(1)
      expect(jobs[0].toString()).to.equal(subject.manager.toString())
    })
  })

  it('should stop running when all api calls complete', function (done) {
    const request = td.object(['get'])
    const subject = new ApiQueue({ request })
    td
      .when(request.get('/rate/limit'))
      .thenResolve({ remaining: 999, reset: 0 })
    td.when(request.get('/some/url')).thenResolve('something')
    subject.getItems().then(res => {
      setTimeout(() => {
        expect(subject.isRunning()).to.equal(false)
        done()
      }, 100)
    })
  })

  it('should pause when rate limit is encountered mid-queue', function (done) {
    const request = td.object(['get'])
    const subject = new ApiQueue({ request })
    td.when(request.get('/rate/limit')).thenResolve(
      { remaining: 2, reset: 0 },
      {
        remaining: 0,
        reset: Date.now() + 1000
      },
      { remaining: 2, reset: 0 }
    )
    td.when(request.get('/some/url/1')).thenResolve('one')
    td.when(request.get('/some/url/2')).thenResolve('two')
    td.when(request.get('/some/url/3')).thenResolve('three')

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
    const request = td.object(['get'])
    const subject = new ApiQueue({ request })

    td.when(request.get('/some/url/1')).thenResolve('one')
    td.when(request.get('/some/url/2')).thenResolve('two')
    td.when(request.get('/some/url/3')).thenResolve('three')
    td
      .when(request.get('/rate/limit'))
      .thenResolve({ remaining: 9999, reset: 0 })

    const results = []

    subject.getItem(1).then(result => results.push(result))
    subject.getItem(2).then(result => results.push(result))

    setTimeout(() => {
      // A little inside baseball, but an accurate test of a stopped queue.
      results.push(`running: ${subject.isRunning()}`)
    }, 250)

    setTimeout(() => {
      subject.getItem(3).then(result => results.push(result))
    }, 500)

    setTimeout(() => {
      // check that queue is stopped with one job (watchdog)
      const jobs = subject.getJobs()
      expect(jobs.length).to.equal(1)
      expect(jobs[0].toString()).to.equal(subject.manager.toString())
      expect(subject.isRunning()).to.equal(false)

      // check results
      expect(results).to.deep.equal(['one', 'two', 'running: false', 'three'])

      done()
    }, 1000)
  })

  it('should retry requests that fail due to rate limits', done => {
    const request = td.object(['get'])
    const subject = new ApiQueue({ request })

    const resetTime = Math.floor(Date.now() / 1000) + 1

    td.when(request.get('/some/url/1')).thenResolve('one')
    td.when(request.get('/some/url/2')).thenResolve('two')
    // We `when` this second so that it will be run first. Tforhou _gh it's harder
    // to read sequentially, it's how mocking libraries work.
    td
      .when(request.get('/some/url/2'), { times: 1 })
      .thenReject({ message: 'API rate limit exceeded', code: 403 })
    td.when(request.get('/some/url/3')).thenResolve('three')
    td
      .when(request.get('/rate/limit'))
      .thenResolve(
        { remaining: 10, reset: resetTime },
        { remaining: 0, reset: resetTime },
        { remaining: 10, reset: resetTime + 1 }
      )

    const results = []

    subject.getItem(1).then(result => results.push(result))
    subject.getItem(2).then(result => results.push(result))
    subject.getItem(3).then(result => results.push(result))

    setTimeout(() => {
      // Because only `two` failed, only `two` is retried.
      expect(results).to.deep.equal(['one', 'three', 'two'])

      done()
    }, 1500)
  })
})
