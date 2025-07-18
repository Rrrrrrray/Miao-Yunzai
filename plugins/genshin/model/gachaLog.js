import base from "./base.js"
import fetch from "node-fetch"
import lodash from "lodash"
import fs from "node:fs"
import common from "../../../lib/common/common.js"
import gsCfg from "./gsCfg.js"
import { Character, Weapon } from "#miao.models"

export default class GachaLog extends base {
  constructor(e) {
    super(e)
    this.model = "gachaLog"

    if (!e.isSr && e.msg) e.isSr = /\/(common|hkrpg)\//.test(e.msg)

    this.urlKey = `${this.prefix}url:`
    /** 绑定的uid */
    this.uidKey = this.e.isSr
      ? `Yz:srJson:mys:qq-uid:${this.userId}`
      : `Yz:genshin:mys:qq-uid:${this.userId}`
    this.path = this.e.isSr
      ? `./data/srJson/${this.e.user_id}/`
      : `./data/gachaJson/${this.e.user_id}/`

    const gsPool = [
      { type: 301, typeName: "角色" },
      { type: 302, typeName: "武器" },
      { type: 500, typeName: "集录" },
      { type: 200, typeName: "常驻" },
    ]

    const srPool = [
      { type: 11, typeName: "角色" },
      { type: 12, typeName: "光锥" },
      { type: 21, typeName: "角色联动" },
      { type: 22, typeName: "光锥联动" },
      { type: 1, typeName: "常驻" },
      { type: 2, typeName: "新手" },
    ]

    this.pool = e.isSr ? srPool : gsPool
  }

  static getIcon(name, type = "role", game = "") {
    if (type === "role" || type === "角色") {
      let char = Character.get(name, game)
      if (!char) {
        console.log("not-found-char", name, game)
      }
      return char?.imgs?.face || ""
    } else if (type === "weapon" || type === "武器" || type === "光锥") {
      let weapon = Weapon.get(name, game)
      if (!weapon) {
        console.log("not-found-weapon", `[${name}]`, game)
      }
      return weapon?.imgs?.icon || ""
    }
  }

  async logUrl() {
    let url = this.e.msg

    /** 处理url */
    let param = this.dealUrl(url)
    if (!param) return

    if (!(await this.checkUrl(param))) return

    this.e.reply("链接发送成功，数据获取中……")

    // 是否全量更新抽卡记录
    this.fetchFullLog = await this.isFetchFullLog()

    /** 制作合并消息 */
    let MakeMsg = []
    let tmpMsg = ""
    /** 按卡池更新记录 */
    for (let i in this.pool) {
      this.type = this.pool[i].type
      this.typeName = this.pool[i].typeName
      let res = await this.updateLog()
      if (res) {
        tmpMsg += `[${this.typeName}]记录获取成功，更新${res.num}条\n`
      }
      if (i <= 1) await common.sleep(500)
    }
    MakeMsg.push(tmpMsg)
    MakeMsg.push(
      `\n抽卡记录更新完成，您还可回复\n【${this?.e?.isSr ? "*" : "#"}全部记录】统计全部抽卡数据\n【${this?.e?.isSr ? "*光锥" : "#武器"}记录】统计${this?.e?.isSr ? "星铁光锥" : "武器"}池数据\n【${this?.e?.isSr ? "*" : "#"}角色统计】按卡池统计数据\n【${this?.e?.isSr ? "*" : "#"}导出记录】导出记录数据`,
    )
    await this.e.reply(MakeMsg)

    if (this.fetchFullLog) {
      await this.setFetchFullLog(false)
    }

    this.isLogUrl = true

    this.all = []
    let data = await this.getLogData()

    this.e.msg = `[uid:${this.uid}]`

    return data
  }

  dealUrl(url) {
    // timestamp=1641338980〈=zh-cn 修复链接有奇怪符号
    url = url.replace(/〈=/g, "&")
    if (url.includes("getGachaLog?")) url = url.split("getGachaLog?")[1]
    if (url.includes("index.html?")) url = url.split("index.html?")[1]

    // 处理参数
    let arr = new URLSearchParams(url).entries()

    let params = {}
    for (let val of arr) {
      params[val[0]] = val[1]
    }

    if (!params.authkey) {
      this.e.reply("链接复制错误")
      return false
    }

    // 去除#/,#/log
    params.authkey = params.authkey.replace(/#\/|#\/log/g, "")

    return params
  }

  async checkUrl(param) {
    if (!param.region) {
      let res = await this.logApi({
        size: 6,
        authkey: param.authkey,
        region: this.e.isSr ? "prod_gf_cn" : "cn_gf01",
      })
      if (!res?.data?.region) {
        res = await this.logApi({
          size: 6,
          authkey: param.authkey,
          region: this.e.isSr ? "prod_official_usa" : "os_usa",
        })
      }

      if (res?.data?.region) {
        param.region = res?.data?.region
      } else {
        await this.e.reply("链接复制错误或已失效")
        return false
      }
    }

    let res = await this.logApi({
      size: 6,
      authkey: param.authkey,
      region: param.region,
    })

    if (res.retcode == -109) {
      await this.e.reply("2.3版本后，反馈的链接已无法查询！请用安卓方式获取链接")
      return false
    }

    if (res.retcode == -101) {
      await this.e.reply("该链接已失效，请重新进入游戏，重新复制链接")
      return false
    }
    if (res.retcode == 400) {
      await this.e.reply("获取数据错误")
      return false
    }
    if (res.retcode == -100) {
      if (this.e.msg.length == 1000) {
        await this.e.reply("输入法限制，链接复制不完整，请更换输入法复制完整链接")
        return false
      }
      await this.e.reply(
        "链接不完整，请长按全选复制全部内容（可能输入法复制限制），或者复制的不是历史记录页面链接",
      )
      return false
    }
    if (res.retcode != 0) {
      await this.e.reply("链接复制错误")
      return false
    }

    if (res?.data?.list && res.data.list.length > 0) {
      this.uid = res.data.list[0].uid
      await redis.setEx(this.uidKey, 3600 * 24 * 30, String(this.uid))

      /** 保存authkey */
      await redis.setEx(`${this.urlKey}${this.uid}`, 86400, param.authkey)

      return true
    } else {
      await this.e.reply("暂无数据，请等待记录后再查询")
      return false
    }
  }

  async logApi(param) {
    // 调用一次接口判断链接是否正确
    let logUrl = "https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog?"
    /** 国际服 */
    if (!["cn_gf01", "cn_qd01"].includes(param.region)) {
      logUrl = "https://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/getGachaLog?"
    }

    let logParam = new URLSearchParams({
      authkey_ver: 1,
      lang: "zh-cn", // 只支持简体中文
      gacha_type: 301,
      page: 1,
      size: 20,
      end_id: 0,
      ...param,
    }).toString()
    const isLd = [21, 22].includes(param.gacha_type)
    if (this.e.isSr) {
      if (isLd) {
        logUrl = "https://public-operation-hkrpg.mihoyo.com/common/gacha_record/api/getLdGachaLog?"
        if (!["prod_gf_cn", "prod_qd_cn"].includes(param.region)) {
          logUrl =
            "https://public-operation-hkrpg-sg.hoyoverse.com/common/gacha_record/api/getLdGachaLog?"
        }
      } else {
        logUrl = "https://public-operation-hkrpg.mihoyo.com/common/gacha_record/api/getGachaLog?"
        if (!["prod_gf_cn", "prod_qd_cn"].includes(param.region)) {
          logUrl =
            "https://public-operation-hkrpg-sg.hoyoverse.com/common/gacha_record/api/getGachaLog?"
        }
      }
      logParam = new URLSearchParams({
        authkey_ver: 1,
        lang: "zh-cn", // 只支持简体中文
        gacha_type: 11,
        page: 1,
        size: 20,
        game_biz: "hkrpg_cn",
        end_id: 0,
        ...param,
      }).toString()
    }
    let res = await fetch(logUrl + logParam).catch(err => {
      logger.error(`[获取抽卡记录失败] ${err}`)
    })
    if (!res || !res.ok) {
      return { retcode: 400 }
    }
    return await res.json()
  }

  async setFetchFullLog(flag) {
    const redisKey = `Yz:settings:fetchFullLog:${this.userId}`
    if (flag) {
      await redis.set(redisKey, 1, { EX: 600 })
      return this.e.reply(
        "已开启全量更新抽卡记录，在10分钟内您的首次抽卡记录将全量更新，用于修复在官方记录有效期内可能发生的数据错误",
      )
    } else {
      await redis.del(redisKey)
      return this.e.reply("已关闭全量更新抽卡记录")
    }
  }

  async isFetchFullLog() {
    const redisKey = `Yz:settings:fetchFullLog:${this.userId}`
    return !!(await redis.get(redisKey))
  }

  /** 更新抽卡记录 */
  async updateLog() {
    /** 获取authkey */
    let authkey = await redis.get(`${this.urlKey}${this.uid}`)
    if (!authkey) return false

    /** 调一次接口判断是否有效 */
    let res = await this.logApi({ gacha_type: this.type, authkey, region: this.getServer() })

    /** key过期，或者没有数据 */
    if (res.retcode !== 0 || !res?.data?.list || res.data.list.length <= 0) {
      logger.debug(`${this.e.logFnc} ${res.message || "error"}`)
      return false
    }

    logger.mark(`${this.e.logFnc}[UID:${this.uid}] 开始获取：${this.typeName}记录...`)
    let all = []

    let logJson = this.readJson()
    /** 第一次获取增加提示 */
    if (lodash.isEmpty(logJson.list) && this.type === 301) {
      await this.e.reply(`开始获取${this.typeName}记录，首次获取数据较多，请耐心等待...`)
    } else if (this.fetchFullLog && this.type === 301) {
      await this.e.reply(`开始获取${this.typeName}记录，全量更新获取数据较多，请耐心等待...`)
    }

    let logRes = await this.getAllLog(logJson.ids, authkey)
    if (logRes.hasErr) {
      this.e.reply(`获取${this.typeName}记录失败`)
      return false
    }

    /** 数据合并 */
    let num = logRes.list.length
    if (num > 0) {
      if (this.fetchFullLog) {
        all = this.mergeGachaData(logRes.list, logJson.list)
      } else {
        all = logRes.list.concat(logJson.list)
      }

      /** 保存json */
      this.writeJson(all)
      this.all = all
    }

    return { num }
  }

  // 合并抽卡记录
  mergeGachaData(remoteList, localList) {
    if (remoteList.length === 0) return localList
    if (localList.length === 0) return remoteList
    // 远程记录的最后一条数据id
    const remoteLastId = remoteList[remoteList.length - 1].id
    if (!remoteLastId) {
      // 可能是mhy数据又出错了
      return remoteList.concat(localList)
    }
    const findIdx = localList.findIndex(item => item.id === remoteLastId)
    if (findIdx === -1) {
      return remoteList.concat(localList)
    }
    // 截取本地数据并合并
    return remoteList.concat(localList.slice(findIdx + 1))
  }

  /** 递归获取所有数据 */
  async getAllLog(ids, authkey, page = 1, endId = 0) {
    /** 延迟下防止武器记录获取失败 */
    await common.sleep(1000)

    let res = await this.logApi({
      gacha_type: this.type,
      page,
      end_id: endId,
      authkey,
      region: this.getServer(),
    })

    if (res.retcode != 0) {
      return { hasErr: true, list: [] }
    }

    if (!res?.data?.list || res.data.list.length <= 0) {
      logger.mark(
        `${this.e.logFnc}[UID:${this.uid}] 获取${this.typeName}记录完成，共${Number(page) - 1}页`,
      )
      return { hasErr: false, list: [] }
    }

    let list = []
    for (let val of res.data.list) {
      if (!this.fetchFullLog && ids.get(String(val.id))) {
        logger.mark(`${this.e.logFnc}[UID:${this.uid}] 获取${this.typeName}记录完成，暂无新记录`)
        return { hasErr: false, list }
      } else {
        list.push(val)
        endId = val.id
      }
    }
    page++

    if (page % 3 == 0) {
      await common.sleep(500)
    } else {
      await common.sleep(300)
    }

    let res2 = await this.getAllLog(ids, authkey, page, endId)

    list = list.concat(res2.list)

    return { hasErr: res2.hasErr, list }
  }

  // 读取本地json
  readJson() {
    let logJson = []
    let ids = new Map()
    let file = `${this.path}/${this.uid}/${this.type}.json`
    if (fs.existsSync(file)) {
      // 获取本地数据 进行数据合并
      logJson = JSON.parse(fs.readFileSync(file, "utf8"))
      for (let val of logJson) {
        if (val.id) {
          ids.set(String(val.id), val.id)
        }
      }
    }

    return { list: logJson, ids }
  }

  creatFile() {
    if (!fs.existsSync(this.path)) {
      fs.mkdirSync(this.path)
    }
    if (!this.uid) return
    let file = `${this.path}${this.uid}/`
    if (!fs.existsSync(file)) {
      fs.mkdirSync(file)
    }
  }

  writeJson(data) {
    this.creatFile()

    let file = `${this.path}${this.uid}/`

    fs.writeFileSync(`${file}${this.type}.json`, JSON.stringify(data, "", "\t"))
  }

  /** #抽卡记录 */
  async getLogData() {
    /** 判断uid */
    await this.getUid()
    if (!this.uid) {
      return false
    }
    if (this.e?.isAll) {
      return await this.getAllGcLogData()
    } else {
      return await this.getGcLogData()
    }
  }

  async getAllGcLogData() {
    this.model = "gachaAllLog"
    const poolList = [
      "角色",
      "角色联动",
      this.e?.isSr ? "光锥" : "武器",
      "光锥联动",
      "集录",
      "常驻",
    ]
    const logData = []
    let fiveMaxNum = 0
    const originalMsg = this.e.msg
    for (let i of poolList) {
      this.e.msg = i
      this.all = []
      let data = await this.getGcLogData()
      if (!data || data.allNum === 0) {
        continue
      }
      if (fiveMaxNum <= data.fiveLog.length) {
        fiveMaxNum = data.fiveLog.length
      }
      data.max = i === "武器" || i === "光锥" ? 80 : 90
      logData.push(data)
    }
    if (logData.length === 0) {
      this.e.reply(`暂无抽卡记录\n${this.e?.isSr ? "*" : "#"}记录帮助，查看配置说明`, false, {
        at: true,
      })
      return true
    }
    for (let i of logData) {
      let diffNum = fiveMaxNum - i.fiveLog.length
      if (diffNum > 0) {
        i.fiveLog = i.fiveLog.concat(new Array(diffNum).fill({ isUp: false, isNull: true }))
      }
    }
    const data = {
      ...logData[0],
      data: logData,
    }
    this.e.msg = originalMsg
    return data
  }

  async getGcLogData() {
    /** 卡池 */
    const { type, typeName } = this.getPool()
    /** 更新记录 */
    if (!this.isLogUrl) await this.updateLog()
    /** 统计计算记录 */
    let data = this.analyse()
    data.type = type
    data.typeName = typeName
    /** 渲染数据 */
    data = this.randData(data)
    return data
  }

  getPool() {
    let msg = this.e.msg.replace(/#|抽卡|记录|祈愿|分析|池|原神|星铁|崩坏星穹铁道|铁道/g, "")
    let type = this.e.isSr ? 11 : 301
    let typeName = "角色"
    switch (msg) {
      case "up":
      case "抽卡":
      case "角色":
      case "抽奖":
        type = this.e.isSr ? 11 : 301
        typeName = "角色"
        break
      case "常驻":
        type = this.e.isSr ? 1 : 200
        typeName = "常驻"
        break
      case "武器":
        type = this.e.isSr ? 12 : 302
        typeName = this.e.isSr ? "光锥" : "武器"
        break
      case "集录":
        type = 500
        typeName = "集录"
        break
      case "光锥":
        type = 12
        typeName = "光锥"
        break
      case "角色联动":
        type = 21
        typeName = "角色联动"
        break
      case "光锥联动":
      case "武器联动":
        type = 22
        typeName = "光锥联动"
        break
      case "新手":
        type = this.e.isSr ? 2 : 100
        typeName = "新手"
        break
    }
    this.type = type
    this.typeName = typeName
    return { type, typeName }
  }

  async getUid() {
    if (!fs.existsSync(this.path)) {
      this.e.reply(`暂无抽卡记录\n${this.e?.isSr ? "*" : "#"}记录帮助，查看配置说明`, false, {
        at: true,
      })
      return false
    }

    let logs = fs.readdirSync(this.path)

    if (lodash.isEmpty(logs)) {
      this.e.reply(`暂无抽卡记录\n${this.e?.isSr ? "*" : "#"}记录帮助，查看配置说明`, false, {
        at: true,
      })
      return false
    }

    if (!this.uid) {
      this.e.at = false
      this.uid = this?.e?.isSr
        ? this.e.user?._games?.sr?.uid
        : this.e.user?._games?.gs?.uid ||
          (await this.e.runtime.getUid(this.e)) ||
          (await redis.get(this.uidKey))
    }

    /** 记录有绑定的uid */
    if (this.uid && logs.includes(String(this.uid))) {
      return this.uid
    }

    /** 拿修改时间最后的uid */
    let uidArr = []
    for (let uid of logs) {
      let json = this?.e?.isSr ? `${this.path}${uid}/11.json` : `${this.path}${uid}/301.json`
      if (!fs.existsSync(json)) {
        continue
      }

      let tmp = fs.statSync(json)
      uidArr.push({
        uid,
        mtimeMs: tmp.mtimeMs,
      })
    }
    if (uidArr.length <= 0) {
      return false
    }

    uidArr = uidArr.sort(function (a, b) {
      return b.mtimeMs - a.mtimeMs
    })

    this.uid = uidArr[0].uid

    return uidArr[0].uid
  }

  /** 统计计算记录 */
  analyse() {
    if (lodash.isEmpty(this.all)) {
      this.all = this.readJson().list
    }
    let fiveLog = []
    let fourLog = []
    let fiveNum = 0
    let fourNum = 0
    let fiveLogNum = 0
    let fourLogNum = 0
    let noFiveNum = 0
    let noFourNum = 0
    let wai = 0 // 歪
    let weaponNum = 0
    let weaponFourNum = 0
    let allNum = this.all.length
    let bigNum = 0
    let game = this.e?.game

    for (let val of this.all) {
      this.role = val
      if (val.rank_type == 4) {
        fourNum++
        if (noFourNum == 0) {
          noFourNum = fourLogNum
        }
        fourLogNum = 0
        if (fourLog[val.name]) {
          fourLog[val.name]++
        } else {
          fourLog[val.name] = 1
        }
        if (val.item_type == "武器" || val.item_type == "光锥") {
          weaponFourNum++
        }
      }
      fourLogNum++

      if (val.rank_type == 5) {
        fiveNum++
        if (fiveLog.length > 0) {
          fiveLog[fiveLog.length - 1].num = fiveLogNum
        } else {
          noFiveNum = fiveLogNum
        }
        fiveLogNum = 0
        let isUp = false
        // 歪了多少个
        if (val.item_type == "角色") {
          if (this.checkIsUp()) {
            isUp = true
          } else {
            wai++
          }
        } else {
          weaponNum++
        }

        fiveLog.push({
          name: val.name,
          icon: GachaLog.getIcon(val.name, val.item_type, game),
          abbrName: gsCfg.shortName(val.name),
          item_type: val.item_type,
          num: 0,
          isUp,
        })
      }
      fiveLogNum++
    }
    if (fiveLog.length > 0) {
      fiveLog[fiveLog.length - 1].num = fiveLogNum

      // 删除未知五星
      for (let i in fiveLog) {
        if (fiveLog[i].name == "未知") {
          allNum = allNum - fiveLog[i].num
          fiveLog.splice(i, 1)
          fiveNum--
        } else {
          // 上一个五星是不是常驻
          let lastKey = Number(i) + 1
          if (fiveLog[lastKey] && !fiveLog[lastKey].isUp) {
            fiveLog[i].minimum = true
            bigNum++
          } else {
            fiveLog[i].minimum = false
          }
        }
      }
    } else {
      // 没有五星
      noFiveNum = allNum
    }

    // 四星最多
    let four = []
    for (let i in fourLog) {
      four.push({
        name: i,
        num: fourLog[i],
      })
    }
    four = four.sort((a, b) => {
      return b.num - a.num
    })

    if (four.length <= 0) {
      four.push({ name: "无", num: 0 })
    }

    let fiveAvg = 0
    let fourAvg = 0
    if (fiveNum > 0) {
      fiveAvg = Math.round((allNum - noFiveNum) / fiveNum)
    }
    if (fourNum > 0) {
      fourAvg = Math.round((allNum - noFourNum) / fourNum)
    }
    // 有效抽卡
    let isvalidNum = 0

    if (fiveNum > 0 && fiveNum > wai) {
      if (fiveLog.length > 0 && !fiveLog[0].isUp) {
        isvalidNum = Math.round((allNum - noFiveNum - fiveLog[0].num) / (fiveNum - wai))
      } else {
        isvalidNum = Math.round((allNum - noFiveNum) / (fiveNum - wai))
      }
    }

    let upYs = isvalidNum * 160
    if (upYs >= 10000) {
      upYs = (upYs / 10000).toFixed(2) + "w"
    } else {
      upYs = upYs.toFixed(0)
    }

    // 小保底不歪概率
    let noWaiRate = 0
    if (fiveNum > 0) {
      noWaiRate = (fiveNum - bigNum - wai) / (fiveNum - bigNum)
      noWaiRate = (noWaiRate * 100).toFixed(1)
    }
    let firstTime = this.all[this.all.length - 1]?.time.substring(0, 16)
    let lastTime = this.all[0]?.time.substring(0, 16)

    return {
      allNum,
      noFiveNum,
      noFourNum,
      fiveNum,
      fourNum,
      fiveAvg,
      fourAvg,
      wai,
      isvalidNum,
      maxFour: four[0],
      weaponNum,
      weaponFourNum,
      firstTime,
      lastTime,
      fiveLog,
      upYs,
      noWaiRate,
    }
  }

  checkIsUp() {
    if (
      [
        "莫娜",
        "七七",
        "迪卢克",
        "琴",
        "姬子",
        "杰帕德",
        "彦卿",
        "白露",
        "瓦尔特",
        "克拉拉",
        "布洛妮娅",
      ].includes(this.role.name)
    ) {
      return false
    }
    let role5join = {
      刻晴: [
        {
          start: "2021-02-17 18:00:00",
          end: "2021-03-02 15:59:59",
        },
      ],
      提纳里: [
        {
          start: "2022-08-24 06:00:00",
          end: "2022-09-09 17:59:59",
        },
      ],
      迪希雅: [
        {
          start: "2023-03-01 06:00:00",
          end: "2023-03-21 17:59:59",
        },
      ],
      梦见月瑞希: [
        {
          start: "2025-02-12 06:00:00",
          end: "2025-03-04 17:59:59",
        },
      ],
      希儿: [
        {
          start: "2023-04-26 06:00:00",
          end: "2023-05-17 17:59:59",
        },
        {
          start: "2023-10-27 12:00:00",
          end: "2023-11-14 14:59:59",
        },
      ],
      刃: [
        {
          start: "2023-07-19 06:00:00",
          end: "2023-08-09 11:59:59",
        },
        {
          start: "2023-12-27 06:00:00",
          end: "2024-01-17 11:59:59",
        },
      ],
      符玄: [
        {
          start: "2023-09-20 12:00:00",
          end: "2023-10-10 14:59:59",
        },
        {
          start: "2024-05-29 12:00:00",
          end: "2024-06-18 14:59:59",
        },
      ],
    }
    if (role5join[this.role.name]) {
      for (const period of role5join[this.role.name]) {
        const start = new Date(period.start).getTime()
        const end = new Date(period.end).getTime()
        const logTime = new Date(this.role.time).getTime()

        if (logTime >= start && logTime <= end) {
          return true
        }
      }
      return false
    }
    return true
  }

  /** 渲染数据 */
  randData(data) {
    const type = data.type || this.type
    const typeName = data.typeName || this.typeName
    const max = type === 12 || type === 22 || type === 302 ? 80 : 90
    let line = []
    let weapon = this.e.isSr ? "光锥" : "武器"
    //最非，最欧
    let maxValue, minValue

    if (data && data.fiveLog) {
      const filteredFiveLog = data.fiveLog.filter(item => item.num !== 0)

      if (filteredFiveLog.length > 0) {
        maxValue = Math.max(...filteredFiveLog.map(item => item.num))
        minValue = Math.min(...filteredFiveLog.map(item => item.num))
      } else {
        if (data.fiveLog[0]) {
          maxValue = data.fiveLog[0]
          minValue = data.fiveLog[0]
        } else {
          maxValue = 0
          minValue = 0
        }
      }
    } else {
      maxValue = 0
      minValue = 0
    }

    if ([301, 11, 21].includes(type)) {
      line = [
        [
          { lable: "未出五星", num: data.noFiveNum, unit: "抽" },
          { lable: "五星", num: data.fiveNum, unit: "个" },
          { lable: "五星平均", num: data.fiveAvg, unit: "抽", color: data.fiveColor },
          { lable: "小保底不歪", num: data.noWaiRate + "%", unit: "" },
          { lable: "最非", num: maxValue, unit: "抽" },
        ],
        [
          { lable: "未出四星", num: data.noFourNum, unit: "抽" },
          { lable: "五星常驻", num: data.wai, unit: "个" },
          { lable: "UP平均", num: data.isvalidNum, unit: "抽" },
          { lable: `UP花费${this?.e?.isSr ? "星琼" : "原石"}`, num: data.upYs, unit: "" },
          { lable: "最欧", num: minValue, unit: "抽" },
        ],
      ]
    }
    // 常驻池
    if ([200, 1].includes(type)) {
      line = [
        [
          { lable: "未出五星", num: data.noFiveNum, unit: "抽" },
          { lable: "五星", num: data.fiveNum, unit: "个" },
          { lable: "五星平均", num: data.fiveAvg, unit: "抽", color: data.fiveColor },
          { lable: `五星${weapon}`, num: data.weaponNum, unit: "个" },
          { lable: "最非", num: maxValue, unit: "抽" },
        ],
        [
          { lable: "未出四星", num: data.noFourNum, unit: "抽" },
          { lable: "四星", num: data.fourNum, unit: "个" },
          { lable: "四星平均", num: data.fourAvg, unit: "抽" },
          { lable: "四星最多", num: data.maxFour.num, unit: data.maxFour.name.slice(0, 4) },
          { lable: "最欧", num: minValue, unit: "抽" },
        ],
      ]
    }
    // 武器池
    if ([302, 12, 22].includes(type)) {
      line = [
        [
          { lable: "未出五星", num: data.noFiveNum, unit: "抽" },
          { lable: "五星", num: data.fiveNum, unit: "个" },
          { lable: "五星平均", num: data.fiveAvg, unit: "抽", color: data.fiveColor },
          { lable: `四星${weapon}`, num: data.weaponFourNum, unit: "个" },
          { lable: "最非", num: maxValue, unit: "抽" },
        ],
        [
          { lable: "未出四星", num: data.noFourNum, unit: "抽" },
          { lable: "四星", num: data.fourNum, unit: "个" },
          { lable: "四星平均", num: data.fourAvg, unit: "抽" },
          { lable: "四星最多", num: data.maxFour.num, unit: data.maxFour.name.slice(0, 4) },
          { lable: "最欧", num: minValue, unit: "抽" },
        ],
      ]
    }
    // 集录池
    if ([500].includes(type)) {
      line = [
        [
          { lable: "未出五星", num: data.noFiveNum, unit: "抽" },
          { lable: "五星", num: data.fiveNum, unit: "个" },
          { lable: "五星平均", num: data.fiveAvg, unit: "抽", color: data.fiveColor },
          { lable: `四星${weapon}`, num: data.weaponFourNum, unit: "个" },
          { lable: "最非", num: maxValue, unit: "抽" },
        ],
        [
          { lable: "未出四星", num: data.noFourNum, unit: "抽" },
          { lable: "四星", num: data.fourNum, unit: "个" },
          { lable: "四星平均", num: data.fourAvg, unit: "抽" },
          { lable: "四星最多", num: data.maxFour.num, unit: data.maxFour.name.slice(0, 4) },
          { lable: "最欧", num: minValue, unit: "抽" },
        ],
      ]
    }
    // 新手池
    if ([100, 2].includes(type)) {
      line = [
        [
          { lable: "未出五星", num: data.noFiveNum, unit: "抽" },
          { lable: "五星", num: data.fiveNum, unit: "个" },
          { lable: "五星平均", num: data.fiveAvg, unit: "抽", color: data.fiveColor },
          { lable: `五星${weapon}`, num: data.weaponNum, unit: "个" },
          { lable: "最非", num: maxValue, unit: "抽" },
        ],
        [
          { lable: "未出四星", num: data.noFourNum, unit: "抽" },
          { lable: "四星", num: data.fourNum, unit: "个" },
          { lable: "四星平均", num: data.fourAvg, unit: "抽" },
          { lable: "四星最多", num: data.maxFour.num, unit: data.maxFour.name.slice(0, 4) },
          { lable: "最欧", num: minValue, unit: "抽" },
        ],
      ]
    }
    let hasMore = false
    // if (this.e.isGroup && data.fiveLog.length > 48) {
    //   data.fiveLog = data.fiveLog.slice(0, 48)
    //   hasMore = true
    // }

    return {
      ...this.screenData,
      saveId: this.uid,
      uid: this.uid,
      type,
      typeName,
      allNum: data.allNum,
      firstTime: data.firstTime,
      lastTime: data.lastTime,
      fiveLog: data.fiveLog,
      line,
      hasMore,
      max,
    }
  }

  getServer() {
    switch (String(this.uid).slice(0, -8)) {
      case "1":
      case "2":
        return this.e.isSr ? "prod_gf_cn" : "cn_gf01" // 官服
      case "5":
        return this.e.isSr ? "prod_qd_cn" : "cn_qd01" // B服
      case "6":
        return this.e.isSr ? "prod_official_usa" : "os_usa" // 美服
      case "7":
        return this.e.isSr ? "prod_official_euro" : "os_euro" // 欧服
      case "8":
      case "18":
        return this.e.isSr ? "prod_official_asia" : "os_asia" // 亚服
      case "9":
        return this.e.isSr ? "prod_official_cht" : "os_cht" // 港澳台服
    }
    return "cn_gf01"
  }
}
