import React, { Component } from 'react'
import './App.css'
import * as moment from 'moment'
import * as throttle from 'lodash.throttle'
import ClickNHold from 'react-click-n-hold'
import * as pkg from '../package.json'
import tutorialImg from './tutorial.png'

/**************************************************************
 * Setup
 **************************************************************/

const firebaseConfig = {
  apiKey: "AIzaSyA58BMqwEAw12sgI4guZbsDdVZ7yoXwDqI",
  authDomain: "zonesofprep.firebaseapp.com",
  databaseURL: "https://zonesofprep.firebaseio.com",
  projectId: "zonesofprep",
  storageBucket: "zonesofprep.appspot.com",
  messagingSenderId: "918887966885"
}

const [STATE_RED, STATE_YELLOW, STATE_GREEN, STATE_NULL] = [-1,0,1,2]

// raineorshine@gmail.com test data: https://console.firebase.google.com/u/0/project/zonesofprep/database/zonesofprep/data/users/T9FGz1flWIf1sQU5B5Qf3q6d6Oy1
const defaultRows = JSON.stringify([{
  checkins: {},
  label: '💤'
}, {
  checkins: {},
  label: '🥗'
}, {
  checkins: {},
  label: '👟'
}])

// firebase init
const firebase = window.firebase
firebase.initializeApp(firebaseConfig)
window.__DEBUG = {}
window.__DEBUG.signout = firebase.auth().signOut.bind(firebase.auth())

const localGet = key => localStorage[localStorage.latestUid + '.' + key]
const localGetTemp = key => localStorage['temp.' + key]
const localSet = (key, value) => localStorage[localStorage.latestUid + '.' + key] = value

// init localStorage
if (!localStorage.latestUid) {
  localStorage.latestUid = 'temp'
}

if (!localGet('zones')) {
  localSet('zones', defaultRows)
}

if (!localGet('showFadedToday')) {
  localSet('showFadedToday', 'true')
}

if (!localGet('decayDays')) {
  localSet('decayDays', JSON.stringify([true, true, true, true, true, true, true]))
}

// manually add/remove class to body since it's outside the target element of render
document.body.classList[localGet('night') === 'true' ? 'add' : 'remove']('night')

/**************************************************************
 * Helper functions
 **************************************************************/

const promoteWithNull = c => (c + 2) % 4 - 1
// const demoteWithNull = c => (c + 4) % 4 - 1
const promote = c => (c + 2) % 3 - 1
const demote = c => (c - 2) % 3 + 1
// const promoteNoWrap = c => c < 1 ? c + 1 : 1
// const demoteNoWrap = c => c > -1 ? c - 1 : -1

/** Returns true if all items in the list are the same. */
const same = list => list.reduce((prev, next) => prev === next ? next : false) !== false

/** Returns true if none of the given checkins have a manual checkin. */
const noManualCheckins = (checkinsInDecayRow, row) => checkinsInDecayRow.every((c, ci) => !(row.manualCheckins && row.manualCheckins[row.checkins.length - ci + 1]))

/* Gets the date of a checkin */
const checkinDate = ci => {
  return moment(this.state.startDate).add(ci, 'days')
}

/** Return a new checkin for a given row with potential decay */
const checkinWithDecay = (row, ci=0, decayDays) => {

  // check if the decay rate has been met
  // e.g. a row with a decay rate of 3 will only decay after 3 days in a row without a checkin
  const readyToDecay = () => {
    const checkinsInDecayRow = row.checkins.slice(ci, ci + row.decay)
    return same(checkinsInDecayRow) && noManualCheckins(checkinsInDecayRow, row)
  }

  return row.decay && // row has a decay
    decayDays[(checkinDate(ci).day() + 1) % 7] && // can decay on this day; add 1 since ci refers to the PREVIOUS day, i.e. if we don't want to decay on Sat/Sun then we need ci to refer to Fri/Sat
    row.checkins[ci] > STATE_RED && // can't decay past red
    readyToDecay() // do last for efficiency
    ? demote(row.checkins[ci])
    : row.checkins[ci]
}

/** Get all the rows with a new column at the beginning. Needed to be separated from setState so it can be used in the constructor. */
const getNewColumn= (rows, decayDays) => {
  return rows.map(z => {
    if (z.checkins) {
      const checkin = z.checkins[0] !== undefined && z.checkins[0] !== STATE_NULL
        ? checkinWithDecay(z, 0, decayDays)
        : STATE_NULL
      z.checkins.unshift(checkin)
    }
    else {
      z.checkins = [STATE_NULL]
    }
    return z
  })
}

/* if missing days, fill them in */
const fill = (rows, startDate, decayDays) => {
  const missingDays = moment().diff(startDate, 'days') - rows[0].checkins.length + 1
  return missingDays > 0
    ? fill(getNewColumn(rows, decayDays), startDate, decayDays)
    : rows
}

const migrate1to2 = oldState => {
  const sampleCheckins = oldState.zones[0].checkins || []

  const newState = {
    startDate: oldState.startDate,
    settings: {
      showCheckins: oldState.showCheckins,
      showFadedToday: oldState.showFadedToday,
      decayDays: oldState.decayDays,
      night: oldState.night
    },
    rows: oldState.zones.map(z => ({
      label: z.label,
      checkins: Object.keys(z.checkins)
        .map((value, i) => {
          // create a new 0-based, right-aligned index
          // subtract 1 because the index for manualCheckins is 1-based instead of 0-based
          const days = z.checkins.length - i - 1
          const date = moment(oldState.startDate).add(days, 'days').format('YYYY-MM-DD')
          return Object.assign({}, z.manualCheckins[days] ? {
            date,
            state: z.checkins[i]
          } : {}, z.notes && z.notes[days] ? {
            date,
            note: z.notes[days]
          } : {})
        })
        // convert back to object
        // filter out empty checkins
        .reduce((prev, next, i) => {
          return Object.keys(next).length ? Object.assign({}, prev, {
            [next.date]: next
          }) : prev
        }, {})
    })),
    scrollY: window.scrollY,
    windowHeight: window.innerHeight
  }

  console.log(newState)

  localSet('rows', JSON.stringify(newState.rows))
  localSet('settings', JSON.stringify(newState.settings))

  return newState
}

/**************************************************************
 * App
 **************************************************************/

class App extends Component {

  constructor() {
    super()

    // load data immediately from localStorage
    const defaultStartDate = localGet('startDate') || moment().subtract(6, 'days').toISOString()
    this.state = localGet('state') || migrate1to2({
      zones: JSON.parse(localGet('zones') || defaultRows),
      startDate: defaultStartDate,
      showCheckins: localGet('showCheckins') === 'true',
      showFadedToday: localGet('showFadedToday') === 'true',
      decayDays: JSON.parse(localGet('decayDays')),
      night: localGet('night') === 'true',
      scrollY: window.scrollY,
      windowHeight: window.innerHeight,
      // start the tutorial if the user has not checked in yet
      tutorial: !localGet('lastUpdated')
    })

    // fill in missing rows
    // NOTE: this.fill must be called AFTER this.state is defined
    this.state.rows = fill(this.state.rows, defaultStartDate, this.state.decayDays)

    // Set to offline mode in 5 seconds. Cancelled with successful login.
    const offlineTimer = window.setTimeout(() => {
      this.setState({ offline: true })
    }, 5000)

    // update scroll for fixing position:fixed controls
    window.addEventListener('scroll', () => {
      this.setState({ scrollY: window.scrollY })
    })

    // update scroll for fixing position:fixed controls
    window.addEventListener('resize', () => {
      // NOTE: window.innerHeight doesn't update properly in the Chrome mobile simulator when switching orientation
      this.setState({ windowHeight: window.innerHeight })
    })

    // keyboard shortcuts
    window.addEventListener('keydown', e => {
      // close all popups if the escape key OR Cmd+Enter OR Control+Enter is hit
      if (e.keyCode === 27 || (e.keyCode === 13 && e.metaKey)) {
        this.setState({
          noteEdit: null,
          noteEditReady: false,
          tutorial: false
        })
      }
    })

    window.addEventListener('mousemove', () => {
      if (!this.state.disableClick) {
        this.setState({ disableClick: true })
      }
    })

    // check if user is logged in
    firebase.auth().onAuthStateChanged(user => {

      // if not logged in, redirect to OAuth login
      if (!user) {
        const provider = new firebase.auth.GoogleAuthProvider();
        firebase.auth().signInWithRedirect(provider)
        return
      }

      // disable offline mode
      window.clearTimeout(offlineTimer)

      // if logged in, save the user ref and uid into state
      const userRef = firebase.database().ref('users/' + user.uid)
      this.setState({
        offline: false,
        userRef,
        user
      })

      // delay presence detection to avoid initial disconnected state
      setTimeout(() => {
        const connectedRef = firebase.database().ref(".info/connected")
        connectedRef.on('value', snap => {
          const connected = snap.val()

          // update offline state
          this.setState({ offline: !connected })

          // when reconnecting, if there are missing days, fill them in, but do not update Firebase
          if (connected) {
            const missingDays = moment().diff(localGet('startDate'), 'days') - this.state.rows[0].checkins.length + 1
            if (missingDays > 0) {
              this.sync('rows', fill(this.state.rows, this.state.startDate, this.state.decayDays), true)
            }
          }
        })
      }, 1000)

      // set latest uid so that offline data is loaded from last user
      // do NOT use localSet (because latestUid is not namespaced by itself)
      // if this is the first login for the user, copy over from temp
      localStorage.latestUid = user.uid
      if (!localGet('rows')) {
        localSet('rows', localGetTemp('rows'))
        localSet('settings', localGetTemp('settings'))
      }

      // load Firebase data
      userRef.on('value', snapshot => {
        const value = snapshot.val()

        if (value) {

          // update user information
          userRef.update({
            name: user.displayName,
            email: user.email
          })

          if (value.showCheckins) {
            this.sync('showCheckins', value.showCheckins, true)
          }

          if (value.night) {
            this.sync('night', value.night, true)
          }

          if (value.showFadedToday) {
            this.sync('showFadedToday', value.showFadedToday, true)
          }

          if (value.decayDays) {
            this.sync('decayDays', value.decayDays, true)
          }

          // save start date or legacy start date
          const startDate = value.startDate || '2018-03-24T06:00:00.000Z'
          this.sync('startDate', startDate, true)

          // if Firebase data is newer than stored data, update localStorage
          if (value.lastUpdated > (localGet('lastUpdated') || 0)) {
            this.sync('rows', this.fill(value.rows, startDate), true)
          }
          // do nothing if Firebase data is older than stored data
        }
        // if no Firebase data, initialize with defaults
        else {
          this.sync('rows', null, true)
        }
      })
    })

    this.toggleSettings = this.toggleSettings.bind(this)
    this.sync = this.sync.bind(this)
    this.row = this.row.bind(this)
    this.checkin = this.checkin.bind(this)
    this.dates = this.dates.bind(this)
    this.render = this.render.bind(this)
    this.addColumn = this.addColumn.bind(this)
    this.addRow = this.addRow.bind(this)
    this.editNote = this.editNote.bind(this)
    this.editNoteThrottled = throttle(this.editNote, 1000, { leading: false })
  }

  /**************************************************************
   * State Change
   **************************************************************/

  // state only
  toggleSettings() {
    this.setState({ showSettings: !this.state.showSettings })
  }

  // save to state, localStorage, and Firebase
  sync(key, value, localOnly) {
    this.setState({ [key]: value }, () => {

      // update localStorage
      localSet(key, key === 'startDate' ? value : JSON.stringify(value))

      // update Firebase
      if (!localOnly) {

        // if syncing rows, update lastUpdated in localStorage
        if (key === 'rows') {
          localSet('lastUpdated', Date.now())
        }

        this.state.userRef.update(
          // if syncing rows, set the start date and lastUpdated
          key === 'rows' ? {
            rows: value,
            startDate: this.state.startDate,
            lastUpdated: Date.now()
          }
          // otherwise just set the value
          : { [key]: value }
        )
      }
    })
  }

  // toggle the state of a checkin
  changeState(z, ci) {
    z.manualCheckins = z.manualCheckins || {}

    // get conditions and values for determining a decayed checkin
    const decayedCheckin = checkinWithDecay(z, ci+1)
    const prevCheckinNull = z.checkins[ci+1] === undefined || z.checkins[ci+1] === STATE_NULL
    const showFaded = (this.state.showFadedToday && ci === 0) || this.state.showCheckins

    // rotate through decayed checkin
    // (normally, add rotation (green ? before : after) decayed checkin matches next checkin
    const useDecayedCheckin = showFaded &&
      z.manualCheckins[z.checkins.length - ci] &&
      !prevCheckinNull &&
      (decayedCheckin === STATE_GREEN ? z.checkins[ci] === STATE_YELLOW : z.checkins[ci] === decayedCheckin)

    // set new checkin and manual checkin
    z.checkins.splice(ci, 1, useDecayedCheckin ? decayedCheckin :
      prevCheckinNull ? promoteWithNull(z.checkins[ci]) :
      /* modified rotation for decayed green*/(z.checkins[ci] === STATE_GREEN && !z.manualCheckins[z.checkins.length - ci] ? STATE_GREEN :
      promote(z.checkins[ci])))
    z.manualCheckins[z.checkins.length - ci] = !useDecayedCheckin

    // update local immediately
    this.sync('rows', this.state.rows, true)

    // update subsequent decayed check-ins (with animation)
    let di = ci-1 // stop any animation in progress
    clearInterval(this.dominoInterval)
    this.dominoInterval = setInterval(() => {

      // only update decayed check-ins coming after the current item
      if (di >= 0 && !z.manualCheckins[z.checkins.length - di]) {

        // update rows
        z.checkins.splice(di, 1, checkinWithDecay(z, di+1))

        // advance animation
        di--

        // update local during animation
        this.sync('rows', this.state.rows, true)
      }
      else {
        // end animation
        clearInterval(this.dominoInterval)

        // update Firebase at end of animation
        // (also applies if there were no subsequent decayed checkins)
        this.sync('rows', this.state.rows)
      }

    }, 60)
  }

  addColumn() {
    this.sync('rows', this.getNewColumn(this.state.rows))
  }

  addRow() {
    const label = prompt('Enter an emoji for your new habit:')
    if (!label) return

    const decay = +prompt('Enter a decay rate. You may enter a value greater than 0 to have the new day\'s checkin decrease if that many days has passed without change. For example, a habit with a decay rate of 3 will automatically decrease after 3 identical checkins in a row.', 0)

    const sampleCheckins = this.state.rows[0].checkins || []
    const rows = this.state.rows.concat([
      {
        label,
        decay,
        checkins: sampleCheckins.concat().fill(STATE_NULL)
      }
    ])
    this.sync('rows', rows)
  }

  editRow(z) {
    const label = prompt(`Enter a new emoji for ${z.label}:`, z.label)
    if (!label) return

    const decay = +prompt('Enter a decay rate. You may enter a value greater than 0 to have the new day\'s checkin decrease if that many days has passed without change. For example, a habit with a decay rate of 3 will automatically decrease after 3 identical checkins in a row.', z.decay)

    z.label = label
    z.decay = decay
    this.sync('rows', this.state.rows)
  }

  moveRowDown(z) {
    const rows = this.state.rows.concat()
    const zi = rows.indexOf(z)
    rows.splice(zi, 1)
    rows.splice(zi+1, 0, z)
    this.sync('rows', rows)
  }

  moveRowUp(z) {
    const rows = this.state.rows.concat()
    const zi = rows.indexOf(z)
    rows.splice(zi, 1)
    rows.splice(zi-1, 0, z)
    this.sync('rows', rows)
  }

  removeRow(z) {
    if (window.confirm(`Are you sure you want to delete ${z.label}?`)) {
      const rows = this.state.rows.concat()
      rows.splice(rows.indexOf(z), 1)
      this.sync('rows', rows)
    }
  }

  removeColumn() {
    const rows = this.state.rows.map(z => {
      z.checkins.shift()
      return z
    })
    this.sync('rows', rows)
  }

  editNote(zi, ci, text) {
    // NOTE: do not pass z directly as the object reference will change asynchronously when state is updated
    // causing obsolete text to be saved to the server at a certain point without any discrepancies visible client-side until the note was closed and re-opened.
    const z = this.state.rows[zi]
    z.notes = z.notes || {}
    if (text) {
      z.notes[z.checkins.length - ci - 1] = text
    }
    else {
      delete z.notes[z.checkins.length - ci - 1]
    }
    this.sync('rows', this.state.rows)
  }

  /**************************************************************
   * Render
   **************************************************************/

  render() {
    // used to vertically center the content
    const contentHeight = this.state.rows.length * 50
    const marginTop = Math.max(0, (window.innerHeight - contentHeight)/2 - 65)

    return <div
      className={'app' +
        (this.state.showSettings ? ' settings-active' : '')}
      // keep track of touch devices so that we can disable duplicate touch/mousedown events
      onTouchStart={() => this.setState({ touch: true })}
    >

      { // tutorial
        this.state.tutorial ? <div className='popup-container tutorial-container' onClick={() => this.setState({ tutorial: false })}>
          <div className='popup tutorial-popup'>
            <img className='tutorial-image' alt='screenshot1' src={tutorialImg}/>
            <p className='tutorial-text'>
              Keep track of habits! <span className='tutorial-colored-text tutorial-red'>Red</span>, <span className='tutorial-colored-text tutorial-yellow'>yellow</span>, <span className='tutorial-colored-text tutorial-green'>green</span>—you choose what each one means!<br/>
              <a className='button tutorial-button'>Let's Go!</a>
            </p>
          </div>
        </div> : null}

      { // notes
        this.state.noteEdit ? <div className='popup-container note-container'>
        <div className='popup note-popup'>
          <p className='note-label'>{this.state.noteEdit.z.label}</p>
          <p className='note-date'>{moment(this.state.startDate).add(this.state.noteEdit.z.checkins.length - this.state.noteEdit.ci - 1, 'days').format('dddd, MMMM Do')}</p>
          <textarea className='note-text' onInput={(e) => this.editNote(this.state.noteEdit.zi, this.state.noteEdit.ci, e.target.value)} defaultValue={this.state.noteEdit.z.notes && this.state.noteEdit.z.notes[this.state.noteEdit.z.checkins.length - this.state.noteEdit.ci - 1]}></textarea>
          <a className='button note-button' onClick={this.state.noteEditReady ? () => this.setState({ noteEdit: null, noteEditReady: false }) : null}>Close</a>
        </div>
      </div> : null}

      { // main content
        // do not render in background of notes on mobile; causes feint gridlines to appear when note closes
        !this.state.tutorial && !(this.state.touch && this.state.noteEdit) ? <div>
          <div className='status'>
            {this.state.offline ? <span className='status-offline'>Working Offline</span> :
            !this.state.user ? <span className='status-loading'>Signing in...</span>
            : null}
          </div>
          <div className='top-options'>
            {this.state.showSettings ? <span className='settings-content'>
              Decay (Mon-Sun): <span className='nowrap'>{[1, 2, 3, 4, 5, 6, 0].map(day =>
                <input key={day} type='checkbox' checked={this.state.decayDays[day]} onChange={() => {
                  this.state.decayDays.splice(day, 1, !this.state.decayDays[day])
                  return this.sync('decayDays', this.state.decayDays)}
                }/>
              )}</span><br/>
              Show today's checkins: <input type='checkbox' disabled={this.state.showCheckins} checked={this.state.showFadedToday} onChange={() => this.sync('showFadedToday', !this.state.showFadedToday)} /><br/>
              Show all checkins: <input type='checkbox' checked={this.state.showCheckins} onChange={() => this.sync('showCheckins', !this.state.showCheckins)} /><br/>
              Night Mode 🌙: <input type='checkbox' checked={this.state.night} onChange={() => {
                document.body.classList[!this.state.night ? 'add' : 'remove']('night')
                this.sync('night', !this.state.night, true)
              }} /><br />
              <a className='settings-showintro text-small' onClick={() => this.setState({ tutorial: true, showSettings: false })}>Show Intro</a><br/>
              <a className='settings-logout text-small' onClick={() => firebase.auth().signOut()}>Log Out</a><br/>
              <hr/>
              <div className='text-small'>
              {this.state.user ? <span>
                <span className='dim'>Logged in as: </span>{this.state.user.email}<br/>
                <span className='dim'>User ID: </span><span className='mono'>{this.state.user.uid}</span><br/>
              </span> : null}
              <span className='dim'>Version: </span>{pkg.version}
              </div>
            </span> : null}
            <span role='img' aria-label='settings' className={'settings-option' + (this.state.showSettings ? ' active' : '')} onClick={this.toggleSettings}>⚙️</span>
          </div>

          <div className='gradient'></div>
          <div className='desktop-mask'></div>
          <div className='content' style={{ marginTop }}>
            {this.state.rows ? <div>
                {this.dates()}
                <div className='rows'>
                  {this.state.rows.map(this.row)}
                  { // move col-options to settlings if enough habits and two weeks of checkins
                    this.state.showSettings || this.state.rows.length < 5 || this.state.rows[0].checkins.length <= 14 ? <div className='left-controls col-options' style={{ top: marginTop + 65 + this.state.rows.length * 50 - this.state.scrollY }}>
                    <span className='box'>
                      <span className='box option col-option' onClick={this.addRow}>+</span>
                    </span>
                  </div> : null}
                </div>
              </div>
              : <p className='loading'>Loading data...</p>
            }
          </div>
        </div> : null
      }
    </div>
  }

  row(z, zi) {
    const contentHeight = this.state.rows.length * 50
    const marginTop = Math.max(65, (this.state.windowHeight - contentHeight)/2)
    const top = marginTop + zi*50 - this.state.scrollY
    return <div className='row' key={z.label}>
      <span className='left-controls' style={{ top }}>
        <span className='row-options'>
          { zi > 0
            ? <span className='box option option-row' onClick={() => this.moveRowUp(z)}>↑</span>
            : <span className='box option option-row option-hidden'></span>
          }
          { zi < this.state.rows.length-1
            ? <span className='box option option-row' onClick={() => this.moveRowDown(z)}>↓</span>
            : <span className='box option option-row option-hidden'></span>
          }
          <span className='box option option-row' onClick={() => this.removeRow(z)}>-</span>
        </span>
        <span className='box row-label' onClick={() => this.editRow(z)}>{z.label}</span>
      </span>
      <span className='checkins'>{z.checkins
        ? Object.keys(z.checkins).map(date => this.checkin(z, zi, date))
        : null
       }</span>
    </div>
  }

  checkin(date, z, zi, c, ci) {
    const hasNote = z.notes && z.notes[z.checkins.length - ci - 1]
    return <ClickNHold
      key={ci}
      className='clicknhold'
      time={0.5}
      onStart={(e) => {
        this.setState({
          disableClick: false
        })
      }}
      onClickNHold={() => {
        if (!this.state.disableClick) {
          this.setState({
            noteEdit: { z, zi, ci }
          })

          // delayed actions
          window.setTimeout(() => {
            // focus on text box
            const noteText = document.querySelector('.note-text')
            if (noteText) {
              noteText.focus()
            }

            // enable close button
            // if this is not delayed, then overlapping touch events on the bottom rows cause the notes to accidentally close immediately after opening
            this.setState({
              noteEditReady: true
            })
          }, 350)
        }
      }}
      onEnd={(e, enough) => {
        // normal click event
        // treat mouse event as duplicate and ignore if on a touchscreen
        if (!this.state.disableClick && !enough && !(this.state.touch && e.type === 'mouseup')) {
          this.changeState(z, ci)
        }

        // must be disableed to avoid duplicate onMouseDown/onTouchStart that the ClickNHold component uses
        this.setState({
          disableClick: true
        })
      }}
    ><span onTouchMove={() => this.setState({ disableClick: true })} className={'box checkin checkin' + c + (
      // today
      ((this.state.showFadedToday && ci === 0) || this.state.showCheckins) &&
      (!z.manualCheckins || !z.manualCheckins[z.checkins.length - ci]) ? ' faded' : '')}>
      {hasNote ? <span className='note-marker'></span> : null}
    </span></ClickNHold>
  }

  dates() {
    return <div className='dates'>
      <div className='box dates-mask'></div>
      {Object.keys(this.state.rows[0].checkins || {}).map(date => {
        return <span key={date} className='box date' title={moment(date).format('dddd, M/D')}>{moment(date).format('D')}</span>
      })}
    </div>
  }
}

export default App
