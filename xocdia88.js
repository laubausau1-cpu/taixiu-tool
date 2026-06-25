
// ============================================================
// xocdia88.js — Engine MD5 + WebSocket + API Server
// 47 pattern, 4 nhánh predict, tự động lưu
// Chạy: node xocdia88.js
// ============================================================

// ============================================================
// MODULE IMPORTS
// ============================================================

// WebSocket client để kết nối tới server game
const WebSocket = require('ws')

// File system để đọc ghi file data
const fs = require('fs')

// Path để xử lý đường dẫn file
const path = require('path')

// HTTP server để tạo API
const http = require('http')


// ============================================================
// CONSTANTS - CẤU HÌNH HỆ THỐNG
// ============================================================

// WebSocket URL mặc định kết nối tới server game
const WS_URL = process.env.WS_URL || 'wss://taixiumd5.system32-cloudfare-356783752985678522.monster/signalr/connect?transport=webSockets&connectionToken=z0%2Bp4sHHXusB7hFR4ZBSkc7TBejGa%2BoooswT8oNe8KhHmsJEIWLTtZh40jp%2FuaCUuwj1vJOAqw%2Fc1EBSv7ebeZGlhgS2FeQ1GNBYU%2F5AVausPA4HmHluu0RJW1Pwcy9H&connectionData=%5B%7B%22name%22%3A%22md5luckydiceHub%22%7D%5D&tid=1'

// Tên hub SignalR để đăng ký với server
const HUB_NAME = 'md5luckydiceHub'

// Thư mục lưu trữ dữ liệu
const DATA_DIR = path.join(__dirname, 'data')

// File lưu lịch sử kết quả
const HISTORY_FILE = path.join(DATA_DIR, 'history.json')

// File lưu log hệ thống
const LOG_FILE = path.join(DATA_DIR, 'log.txt')

// File lưu lịch sử dự đoán
const PRED_FILE = path.join(DATA_DIR, 'prediction_log.json')

// Cổng API server
const API_PORT = parseInt(process.env.PORT || '8888')

// Thời gian tự động lưu data (5 phút)
const SAVE_MS = 300000

// Số lượng lịch sử tối đa trong bộ nhớ
const MAX_H = 100000

// Số phiên tối thiểu để bắt đầu dự đoán
const MIN_S = 6


// ============================================================
// HÀM TIỆN ÍCH
// ============================================================

/**
 * Tạo thư mục data nếu chưa tồn tại
 * Đầu vào: không
 * Đầu ra: không - tạo thư mục data
 */
function ensureDir() {
    // Bọc trong try-catch để tránh crash
    try {
        // Kiểm tra thư mục data đã tồn tại chưa
        if (!fs.existsSync(DATA_DIR)) {
            // Tạo thư mục data với recursive
            fs.mkdirSync(DATA_DIR, { recursive: true })
            // Log thông báo tạo thành công
            log('INFO', 'Đã tạo thư mục data: ' + DATA_DIR)
        }
    } catch (err) {
        // Log lỗi nếu không tạo được thư mục
        log('ERROR', 'Không tạo được thư mục data: ' + err.message)
    }
}


/**
 * Ghi log ra console và file log.txt
 * Đầu vào: level - mức độ log (INFO/WARN/ERROR)
 *          message - nội dung log
 * Đầu ra: không - ghi ra console và file
 */
function log(level, message) {
    // Tạo timestamp hiện tại theo ISO format
    const timestamp = new Date().toISOString()
    // Format dòng log với timestamp và level
    const line = '[' + timestamp + '] [' + level + '] ' + message
    // In ra console để xem trực tiếp
    console.log(line)
    // Bọc trong try-catch để tránh lỗi ghi file
    try {
        // Ghi thêm dòng log vào file log.txt
        fs.appendFileSync(LOG_FILE, line + '\n')
    } catch (err) {
        // In lỗi ra console nếu không ghi được file
        console.error('Không ghi được log file:', err.message)
    }
}


/**
 * Giới hạn giá trị trong khoảng [min, max]
 * Đầu vào: value - giá trị cần clamp
 *          min - giới hạn dưới
 *          max - giới hạn trên
 * Đầu ra: giá trị đã được clamp
 */
function clamp(value, min, max) {
    // Nếu value nhỏ hơn min thì trả về min
    if (value < min) {
        return min
    }
    // Nếu value lớn hơn max thì trả về max
    if (value > max) {
        return max
    }
    // Ngược lại trả về chính value
    return value
}


/**
 * Format thời gian từ milliseconds thành chuỗi "0d 0h 0m"
 * Đầu vào: ms - thời gian tính bằng milliseconds
 * Đầu ra: chuỗi format thời gian
 */
function timeStr(ms) {
    // Tính số giây từ milliseconds
    const seconds = Math.floor(ms / 1000)
    // Tính số phút từ giây
    const minutes = Math.floor(seconds / 60)
    // Tính số giờ từ phút
    const hours = Math.floor(minutes / 60)
    // Tính số ngày từ giờ
    const days = Math.floor(hours / 24)
    // Trả về chuỗi format "0d 0h 0m"
    return days + 'd ' + (hours % 24) + 'h ' + (minutes % 60) + 'm'
}


/**
 * Hàm sigmoid: 1 / (1 + e^(-x))
 * Đầu vào: x - giá trị đầu vào
 * Đầu ra: giá trị sigmoid trong khoảng (0, 1)
 */
function sigmoid(x) {
    // Tính e mũ -x
    const expNegX = Math.exp(-x)
    // Tính mẫu số 1 + e^(-x)
    const denominator = 1.0 + expNegX
    // Trả về 1 / mẫu số
    return 1.0 / denominator
}


/**
 * Tính xác suất với Laplace smoothing: P = (c + 1) / (t + 2)
 * Đầu vào: c - số lần thành công
 *          t - tổng số lần thử
 * Đầu ra: xác suất đã được làm mịn Laplace
 */
function laplaceProb(c, t) {
    // Tử số = số lần thành công + 1
    const numerator = c + 1
    // Mẫu số = tổng số lần + 2
    const denominator = t + 2
    // Trả về xác suất Laplace
    return numerator / denominator
}


/**
 * Chuẩn hóa kết quả Tài/Xỉu thành 'T' hoặc 'X'
 * Đầu vào: raw - chuỗi kết quả thô
 * Đầu ra: 'T' hoặc 'X'
 */
function normalizeResult(raw) {
    // Nếu không có dữ liệu thì trả về 'T'
    if (!raw) {
        return 'T'
    }
    // Chuyển về chữ thường và bỏ khoảng trắng
    const lower = raw.trim().toLowerCase()
    // Bảng mapping các từ khóa về Tài/Xỉu
    const map = {
        't': 'T',
        'tai': 'T',
        'tài': 'T',
        'x': 'X',
        'xiu': 'X',
        'xỉu': 'X',
        'c': 'T',
        'chan': 'T',
        'chẵn': 'T',
        'l': 'X',
        'le': 'X',
        'lẻ': 'X'
    }
    // Trả về ký hiệu T hoặc X từ bảng mapping
    const result = map[lower]
    // Nếu không có trong bảng mapping thì trả về 'T'
    if (result) {
        return result
    }
    return 'T'
}


/**
 * Lấy N phần tử cuối cùng từ mảng
 * Đầu vào: arr - mảng dữ liệu
 *          n - số phần tử cần lấy
 * Đầu ra: mảng n phần tử cuối
 */
function getLastN(arr, n) {
    // Nếu n <= 0 thì trả về mảng rỗng
    if (n <= 0) {
        return []
    }
    // Tạo mảng kết quả rỗng
    const result = []
    // Duyệt từ cuối mảng lên đầu
    for (let i = arr.length - 1; i >= 0; i--) {
        // Nếu đã lấy đủ n phần tử thì dừng
        if (result.length >= n) {
            break
        }
        // Thêm phần tử vào mảng kết quả
        result.push(arr[i])
    }
    // Đảo ngược để trả về đúng thứ tự ban đầu
    result.reverse()
    // Trả về mảng kết quả
    return result
}


/**
 * Tính calcProb: clamp(score, 0.1, 0.95) * 0.5 ± 0.5
 * Đầu vào: c - boolean hướng (true = Tài)
 *          score - điểm số
 * Đầu ra: xác suất trong khoảng [0, 1]
 */
function calcProb(c, score) {
    // Clamp score trong khoảng [0.1, 0.95]
    const clampedScore = clamp(score, 0.1, 0.95)
    // Tính một nửa của score đã clamp
    const half = clampedScore * 0.5
    // Nếu c = true (Tài): 0.5 + half
    if (c) {
        return 0.5 + half
    }
    // Nếu c = false (Xỉu): 0.5 - half
    return 0.5 - half
}


/**
 * Hàm forward neural network
 * Đầu vào: inputs - mảng giá trị đầu vào
 *          weights - mảng trọng số
 *          bias - độ lệch
 * Đầu ra: giá trị sigmoid đã clamp trong [0, 1]
 */
function forward(inputs, weights, bias) {
    // Bắt đầu với bias
    let sum = bias
    // Cộng dồn input[i] * weights[i]
    for (let i = 0; i < inputs.length; i++) {
        // Nếu đã hết weights thì dừng
        if (i >= weights.length) {
            break
        }
        // Cộng tích input và weight vào tổng
        sum = sum + inputs[i] * weights[i]
    }
    // Trả về sigmoid đã clamp trong [0, 1]
    return clamp(sigmoid(sum), 0.0, 1.0)
}


/**
 * Hàm getQuickAnalysis: phân tích nhanh 20 phiên cuối
 * Đầu vào: history - mảng lịch sử các phiên
 * Đầu ra: { prediction: boolean, confidence: number }
 */
function getQuickAnalysis(history) {
    // Lấy 20 phiên cuối cùng
    const sessions = getLastN(history, 20)
    // Nếu không có phiên nào thì trả về mặc định
    if (sessions.length === 0) {
        return { prediction: true, confidence: 0.5 }
    }
    // Đếm số phiên Tài
    let taiCount = 0
    // Duyệt qua từng phiên
    for (const s of sessions) {
        // Nếu kết quả là Tài thì tăng biến đếm
        if (s.result === 'T') {
            taiCount = taiCount + 1
        }
    }
    // Tổng số phiên
    const total = sessions.length
    // Tính xác suất Tài bằng Laplace smoothing
    const probTai = laplaceProb(taiCount, total)
    // Tính độ lệch so với 0.5
    const diff = probTai - 0.5
    // Tính imbalance và clamp trong [0.3, 0.88]
    const imbalance = clamp(Math.abs(diff) * 1.5, 0.3, 0.88)
    // Dự đoán: true nếu số Tài >= số Xỉu
    const prediction = taiCount >= (total - taiCount)
    // Trả về kết quả
    return { prediction: prediction, confidence: imbalance }
}


// ============================================================
// CLASS PREDICTIONENGINE
// Dịch 100% từ FloatingServiceXocDiaMD5.smali
// 47 pattern + 4 nhánh predict
// ============================================================

class PredictionEngine {

    /**
     * Khởi tạo engine với các tham số từ Smali
     */
    constructor() {
        // Bộ trọng số neural network [0.35, 0.35, 0.3] từ Smali
        this.weights = [0.35, 0.35, 0.3]

        // Bias neural network
        this.bias = 0.5

        // Số phiên tối thiểu để bắt đầu phân tích
        this.MIN_S = 6

        // Lịch sử kết quả các phiên
        this.history = []

        // Danh sách phiên đầy đủ (bao gồm cả thông tin dice)
        this.sessions = []

        // Log dự đoán
        this.predictionLog = []

        // Dự đoán cuối cùng
        this.lastPrediction = null

        // ID phiên cuối cùng
        this.lastSessionId = 0

        // Trọng số từng pattern (từ file hoặc mặc định)
        this.patternWeights = {}

        // Đếm số lần pattern dự đoán đúng
        this.patternSuccessCount = {}

        // Đếm số lần pattern dự đoán sai
        this.patternFailCount = {}

        // Lưu thời gian giữa các phiên
        this.y = []

        // Thống kê engine
        this.stats = {
            totalSessions: 0,
            totalTai: 0,
            totalXiu: 0,
            correctPredictions: 0,
            wrongPredictions: 0,
            longestTaiStreak: 0,
            longestXiuStreak: 0,
            currentStreakType: null,
            currentStreakCount: 0,
            startTime: Date.now()
        }

        // Tải dữ liệu từ file
        this.loadHistory()

        // Tải prediction log từ file
        this.loadPredictionLog()

        // Hiệu chỉnh từ lịch sử
        this.calibrateFromHistory()
    }


    /**
     * Tải lịch sử từ file history.json
     * Đầu vào: không
     * Đầu ra: không - nạp vào this.history và this.sessions
     */
    loadHistory() {
        try {
            // Kiểm tra file history.json có tồn tại không
            if (fs.existsSync(HISTORY_FILE)) {
                // Đọc và parse JSON
                const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))

                // Nếu có dữ liệu history
                if (data.history && Array.isArray(data.history)) {
                    // Nạp từng phiên vào history
                    for (const item of data.history) {
                        // Tạo object phiên
                        const session = {
                            sessionId: item.sessionId,
                            result: item.result,
                            total: item.total,
                            timestamp: item.timestamp || Date.now()
                        }
                        // Thêm vào history
                        this.history.push(session)

                        // Cập nhật thống kê
                        this.stats.totalSessions = this.stats.totalSessions + 1

                        // Cập nhật đếm Tài/Xỉu
                        if (item.result === 'T') {
                            this.stats.totalTai = this.stats.totalTai + 1
                        } else {
                            this.stats.totalXiu = this.stats.totalXiu + 1
                        }
                    }
                    // Log số phiên đã tải
                    log('INFO', 'Đã tải ' + data.history.length + ' phiên từ history.json')
                }

                // Nếu có dữ liệu sessions
                if (data.sessions && Array.isArray(data.sessions)) {
                    this.sessions = data.sessions
                }

                // Nếu có dữ liệu stats
                if (data.stats) {
                    this.stats = Object.assign({}, this.stats, data.stats)
                    this.stats.startTime = this.stats.startTime || Date.now()
                }
            }
        } catch (err) {
            // Log lỗi nếu không tải được
            log('ERROR', 'Lỗi tải history.json: ' + err.message)
        }
    }


    /**
     * Tải prediction log từ file
     * Đầu vào: không
     * Đầu ra: không - nạp vào this.predictionLog
     */
    loadPredictionLog() {
        try {
            // Kiểm tra file prediction_log.json có tồn tại không
            if (fs.existsSync(PRED_FILE)) {
                // Đọc và parse JSON
                const data = JSON.parse(fs.readFileSync(PRED_FILE, 'utf8'))

                // Nếu là mảng thì nạp vào predictionLog
                if (Array.isArray(data)) {
                    this.predictionLog = data
                    // Log số dự đoán đã tải
                    log('INFO', 'Đã tải ' + data.length + ' dự đoán từ prediction_log.json')
                }
            }
        } catch (err) {
            // Log lỗi nếu không tải được
            log('ERROR', 'Lỗi tải prediction_log.json: ' + err.message)
        }
    }


    /**
     * Lưu lịch sử ra file history.json
     * Đầu vào: không
     * Đầu ra: không - ghi file
     */
    saveHistory() {
        try {
            // Tạo object dữ liệu để lưu
            const data = {
                history: this.history.slice(-10000),
                sessions: this.sessions.slice(-10000),
                stats: this.stats,
                savedAt: new Date().toISOString()
            }
            // Ghi ra file history.json
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2))
        } catch (err) {
            // Log lỗi nếu không lưu được
            log('ERROR', 'Lỗi lưu history.json: ' + err.message)
        }
    }


    /**
     * Lưu prediction log ra file
     * Đầu vào: không
     * Đầu ra: không - ghi file
     */
    savePredictionLog() {
        try {
            // Lấy tối đa 10000 dự đoán gần nhất
            const data = this.predictionLog.slice(-10000)
            // Ghi ra file prediction_log.json
            fs.writeFileSync(PRED_FILE, JSON.stringify(data, null, 2))
        } catch (err) {
            // Log lỗi nếu không lưu được
            log('ERROR', 'Lỗi lưu prediction_log.json: ' + err.message)
        }
    }


    /**
     * Hiệu chỉnh engine từ dữ liệu lịch sử
     * Đầu vào: không
     * Đầu ra: không
     */
    calibrateFromHistory() {
        try {
            // Nếu có đủ dữ liệu lịch sử
            if (this.history.length >= this.MIN_S) {
                // Cập nhật thời gian giữa các phiên
                const maxCalibrate = Math.min(this.history.length, 20)
                // Duyệt qua từng phiên
                for (let i = 1; i < maxCalibrate; i++) {
                    // Tính khoảng thời gian giữa 2 phiên
                    const delta = (this.history[i].timestamp - this.history[i - 1].timestamp) / 1000
                    // Thêm vào mảng y
                    this.y.push(delta)
                }
                // Log thông báo
                log('INFO', 'Đã hiệu chỉnh từ ' + this.history.length + ' phiên lịch sử')
            }
        } catch (err) {
            // Log lỗi nếu không hiệu chỉnh được
            log('ERROR', 'Lỗi hiệu chỉnh: ' + err.message)
        }
    }


    /**
     * Lấy N phần tử cuối cùng từ lịch sử
     * Đầu vào: count - số phần tử cần lấy
     * Đầu ra: mảng count phần tử cuối
     */
    getLastElements(count) {
        return getLastN(this.history, count)
    }


    /**
     * Lấy phần tử từ vị trí pos tính từ cuối lên
     * Đầu vào: pos - vị trí tính từ cuối (0 = cuối cùng)
     * Đầu ra: phần tử tại vị trí đó hoặc null
     */
    getElementFromEnd(pos) {
        // Tính index từ đầu mảng
        const idx = this.history.length - 1 - pos
        // Trả về phần tử nếu index hợp lệ
        if (idx >= 0) {
            return this.history[idx]
        }
        return null
    }


    /**
     * Đếm số lần xuất hiện của một giá trị trong mảng
     * Đầu vào: arr - mảng dữ liệu
     *          val - giá trị cần đếm
     * Đầu ra: số lần xuất hiện
     */
    countOccurrences(arr, val) {
        // Khởi tạo biến đếm
        let count = 0
        // Duyệt qua từng phần tử trong mảng
        for (const item of arr) {
            // Nếu phần tử bằng giá trị cần đếm
            if (item === val) {
                // Tăng biến đếm lên 1
                count = count + 1
            }
        }
        // Trả về số lần xuất hiện
        return count
    }


    /**
     * Đếm streak của phần tử cuối cùng trong mảng
     * Đầu vào: arr - mảng dữ liệu
     * Đầu ra: số lượng phần tử liên tiếp giống nhau tính từ cuối
     */
    getStreak(arr) {
        // Nếu mảng rỗng thì streak = 0
        if (arr.length === 0) {
            return 0
        }
        // Lấy phần tử cuối cùng
        const last = arr[arr.length - 1]
        // Khởi tạo biến đếm streak
        let count = 0
        // Đếm ngược từ cuối lên
        for (let i = arr.length - 1; i >= 0; i--) {
            // Dừng khi gặp phần tử khác
            if (arr[i] !== last) {
                break
            }
            // Tăng biến đếm
            count = count + 1
        }
        // Trả về độ dài streak
        return count
    }


    // ============================================================
    // 47 PATTERN ANALYSIS
    // ============================================================

    /**
     * Phân tích tất cả 47 pattern
     * Tương đương hàm j() trong Smali
     * Đầu vào: không (dùng this.history)
     * Đầu ra: mảng các pattern đã sắp xếp theo score giảm dần
     */
    analyzeAllPatterns() {
        // Cần ít nhất 8 phiên để phân tích
        if (this.history.length < 8) {
            // Trả về mảng rỗng nếu chưa đủ dữ liệu
            return []
        }

        // Lấy 80 phiên cuối để phân tích
        const sessions = getLastN(this.history, 80)

        // Lấy danh sách kết quả T/X từ các phiên
        const results = sessions.map(function(s) {
            return s.result
        })

        // Lấy kết quả cuối cùng
        const lastResult = results.length > 0 ? results[results.length - 1] : null

        // Lấy 10 kết quả cuối
        const last10 = results.slice(-10)

        // Đếm số Tài trong 10 kết quả cuối
        const taiCount10 = last10.filter(function(r) {
            return r === 'T'
        }).length

        // Lấy 20 kết quả cuối
        const last20 = results.slice(-20)

        // Đếm số Tài trong 20 kết quả cuối
        const taiCount20 = last20.filter(function(r) {
            return r === 'T'
        }).length

        // Lấy quick analysis
        const qa = getQuickAnalysis(this.history)

        // Tính minS từ thời gian giữa phiên
        let minS = 6
        if (this.y.length > 0) {
            // Tính thời gian trung bình
            const sumY = this.y.reduce(function(a, b) {
                return a + b
            }, 0)
            const avgTime = sumY / this.y.length
            // Clamp minS trong khoảng [6, 10]
            minS = Math.max(6, Math.min(Math.floor(avgTime * 1.5), 10))
        }

        // Mảng chứa các pattern khớp
        const matchedPatterns = []


        // ============================================================
        // PATTERN 1: Bệt ngắn (2 phiên cuối giống nhau)
        // ============================================================
        {
            // Lấy 2 phiên cuối cùng
            const lastTwo = results.slice(-2)

            // Kiểm tra 2 phiên cuối có giống nhau không
            if (lastTwo.length === 2) {
                // Lấy phiên áp cuối
                const secondLast = lastTwo[0]
                // Lấy phiên cuối cùng
                const last = lastTwo[1]

                // Nếu 2 phiên giống nhau
                if (secondLast === last) {
                    // Dự đoán tiếp tục theo streak
                    const patternPrediction = last === 'T'

                    // Thêm vào danh sách pattern khớp
                    matchedPatterns.push({
                        name: 'Bệt ngắn',
                        prediction: patternPrediction
                    })
                }
            }
        }


        // ============================================================
        // PATTERN 2: Bệt dài (6 phiên cuối đều T hoặc đều X)
        // ============================================================
        {
            // Lấy 6 phiên cuối cùng
            const lastSix = results.slice(-6)

            // Kiểm tra đủ 6 phiên
            if (lastSix.length === 6) {
                // Lấy giá trị phiên đầu tiên trong 6 phiên
                const firstValue = lastSix[0]

                // Kiểm tra tất cả có giống nhau không
                let allSame = true
                for (const r of lastSix) {
                    if (r !== firstValue) {
                        allSame = false
                        break
                    }
                }

                // Nếu tất cả giống nhau
                if (allSame) {
                    // Dự đoán tiếp tục streak
                    const patternPrediction = firstValue === 'T'

                    // Thêm vào danh sách
                    matchedPatterns.push({
                        name: 'Bệt dài',
                        prediction: patternPrediction
                    })
                }
            }
        }


        // ============================================================
        // PATTERN 3: Đảo 1-1 ngắn (lst[0]===lst[2] && lst[0]!==lst[1])
        // ============================================================
        {
            // Lấy 3 phiên cuối cùng
            const lastThree = results.slice(-3)

            // Kiểm tra đủ 3 phiên
            if (lastThree.length === 3) {
                // Lấy giá trị từng phiên
                const first = lastThree[0]
                const second = lastThree[1]
                const third = lastThree[2]

                // Kiểm tra mẫu đảo 1-1: A, B, A
                if (first === third && first !== second) {
                    // Dự đoán đảo ngược: nếu cuối là A thì dự đoán B
                    const patternPrediction = third !== 'T'

                    // Thêm vào danh sách
                    matchedPatterns.push({
                        name: 'Đảo 1-1 ngắn',
                        prediction: patternPrediction
                    })
                }
            }
        }


        // ============================================================
        // PATTERN 4: Đảo 1-1 dài (5 phiên xen kẽ hoàn toàn)
        // ============================================================
        {
            // Lấy 5 phiên cuối cùng
            const lastFive = results.slice(-5)

            // Kiểm tra đủ 5 phiên
            if (lastFive.length === 5) {
                // Biến kiểm tra xen kẽ hoàn toàn
                let alternating = true

                // Kiểm tra từng cặp liên tiếp
                for (let i = 0; i < 4; i++) {
                    if (lastFive[i] === lastFive[i + 1]) {
                        alternating = false
                        break
                    }
                }

                // Nếu xen kẽ hoàn toàn
                if (alternating) {
                    // Dự đoán ngược với phiên cuối
                    const patternPrediction = lastFive[4] !== 'T'

                    // Thêm vào danh sách
                    matchedPatterns.push({
                        name: 'Đảo 1-1 dài',
                        prediction: patternPrediction
                    })
                }
            }
        }


        // ============================================================
        // PATTERN 5: Cầu 1-2
        // ============================================================
        {
            // Lấy 3 phiên cuối cùng
            const lastThree = results.slice(-3)

            // Kiểm tra đủ 3 phiên
            if (lastThree.length === 3) {
                // Đếm số Tài trong 3 phiên
                const taiCount = lastThree.filter(function(r) {
                    return r === 'T'
                }).length

                // Kiểm tra vị trí trong chu kỳ
                const modResult = this.history.length % 3

                // Nếu vị trí 0 hoặc 2 và có >= 2 Tài
                if ((modResult === 0 || modResult === 2) && taiCount >= 2) {
                    // Dự đoán Tài
                    matchedPatterns.push({
                        name: 'Cầu 1-2',
                        prediction: true
                    })
                }
            }
        }


        // ============================================================
        // PATTERN 6: Cầu 2-1
        // ============================================================
        {
            // Lấy 3 phiên cuối cùng
            const lastThree = results.slice(-3)

            // Kiểm tra đủ 3 phiên
            if (lastThree.length === 3) {
                // Đếm số Tài trong 3 phiên
                const taiCount = lastThree.filter(function(r) {
                    return r === 'T'
                }).length

                // Kiểm tra vị trí trong chu kỳ
                const modResult = this.history.length % 3

                // Nếu vị trí 1 và có >= 2 Tài
                if (modResult === 1 && taiCount >= 2) {
                    // Dự đoán Tài
                    matchedPatterns.push({
                        name: 'Cầu 2-1',
                        prediction: true
                    })
                }
            }
        }


        // ============================================================
        // PATTERN 7: Kép 2-2 (4 phiên AABB)
        // ============================================================
        {
            // Lấy 4 phiên cuối cùng
            const lastFour = results.slice(-4)

            // Kiểm tra đủ 4 phiên
            if (lastFour.length === 4) {
                // Lấy giá trị từng phiên
                const first = lastFour[0]
                const second = lastFour[1]
                const third = lastFour[2]
                const fourth = lastFour[3]

                // Kiểm tra mẫu AABB
                if (first === second && third === fourth && first !== third) {
                    // Dự đoán ngược với cặp cuối
                    const patternPrediction = third !== 'T'

                    // Thêm vào danh sách
                    matchedPatterns.push({
                        name: 'Kép 2-2',
                        prediction: patternPrediction
                    })
                }
            }
        }


        // ============================================================
        // PATTERN 8: Cầu 3-1 (4 cuối T>=3 hoặc X<=1)
        // ============================================================
        {
            // Lấy 4 phiên cuối cùng
            const lastFour = results.slice(-4)

            // Kiểm tra đủ 4 phiên
            if (lastFour.length === 4) {
                // Đếm số Tài trong 4 phiên
                const taiCount = lastFour.filter(function(r) {
                    return r === 'T'
                }).length

                // Nếu Tài >= 3 thì dự đoán Xỉu (đảo)
                if (taiCount >= 3) {
                    matchedPatterns.push({
                        name: 'Cầu 3-1',
                        prediction: false
                    })
                }

                // Nếu Xỉu >= 3 (Tài <= 1) thì dự đoán Tài (đảo)
                if (taiCount <= 1) {
                    matchedPatterns.push({
                        name: 'Cầu 3-1',
                        prediction: true
                    })
                }
            }
        }


        // ============================================================
        // PATTERN 9: Imbalance (10 cuối T>X hoặc X>T)
        // ============================================================
        {
            // Lấy 10 phiên cuối
            const lastTen = results.slice(-10)

            // Kiểm tra đủ 10 phiên
            if (lastTen.length === 10) {
                // Đếm số Tài
                const taiCount = lastTen.filter(function(r) {
                    return r === 'T'
                }).length

                // Đếm số Xỉu
                const xiuCount = lastTen.length - taiCount

                // Nếu Tài nhiều hơn Xỉu
                if (taiCount > xiuCount) {
                    matchedPatterns.push({
                        name: 'Imbalance',
                        prediction: true
                    })
                }

                // Nếu Xỉu nhiều hơn Tài
                if (xiuCount > taiCount) {
                    matchedPatterns.push({
                        name: 'Imbalance',
                        prediction: false
                    })
                }
            }
        }


        // ============================================================
        // PATTERN 10: Ngẫu nhiên (random 50/50)
        // ============================================================
        {
            // Dự đoán ngẫu nhiên
            const randomPrediction = Math.random() < 0.5

            // Luôn thêm pattern ngẫu nhiên vào danh sách
            matchedPatterns.push({
                name: 'Ngẫu nhiên',
                prediction: randomPrediction
            })
        }


        // ============================================================
        // PATTERN 11: Bệt siêu dài (10 phiên đều T hoặc đều X)
        // ============================================================
        {
            // Lấy 10 phiên cuối
            const lastTenPattern = results.slice(-10)

            // Kiểm tra đủ 10 phiên
            if (lastTenPattern.length === 10) {
                // Lấy giá trị đầu tiên
                const firstValue = lastTenPattern[0]

                // Kiểm tra tất cả giống nhau
                let allSame = true
                for (const r of lastTenPattern) {
                    if (r !== firstValue) {
                        allSame = false
                        break
                    }
                }

                // Nếu tất cả giống nhau
                if (allSame) {
                    // Dự đoán tiếp tục streak
                    matchedPatterns.push({
                        name: 'Bệt siêu dài',
                        prediction: firstValue === 'T'
                    })
                }
            }
        }


        // ============================================================
        // PATTERN 12: Bệt xen kẽ ngắn
        // ============================================================
        {
            // Lấy streak hiện tại
            const streakLen = this.getStreak(results)

            // Nếu streak đủ dài
            if (streakLen >= 3 && streakLen <= 5) {
                // Lấy kết quả cuối
                const lastValue = results[results.length - 1]

                // Dự đoán tiếp tục streak
                matchedPatterns.push({
                    name: 'Bệt xen kẽ ngắn',
                    prediction: lastValue === 'T'
                })
            }
        }


        // ============================================================
        // PATTERN 13: Bệt gãy nhẹ
        // ============================================================
        {
            // Lấy streak hiện tại
            const streakLen = this.getStreak(results)

            // Nếu streak dài vừa phải (có thể gãy)
            if (streakLen >= 4 && streakLen <= 7) {
                // Lấy kết quả cuối
                const lastValue = results[results.length - 1]

                // Dự đoán đảo chiều (gãy)
                matchedPatterns.push({
                    name: 'Bệt gãy nhẹ',
                    prediction: lastValue !== 'T'
                })
            }
        }


        // ============================================================
        // PATTERN 14: Đảo 1-1
        // ============================================================
        {
            // Lấy 2 phiên cuối
            const lastTwo = results.slice(-2)

            // Nếu 2 phiên cuối khác nhau
            if (lastTwo.length === 2 && lastTwo[0] !== lastTwo[1]) {
                // Dự đoán tiếp tục đảo
                matchedPatterns.push({
                    name: 'Đảo 1-1',
                    prediction: lastTwo[1] !== 'T'
                })
            }
        }


        // ============================================================
        // PATTERN 15: Kép 2-2 mở rộng
        // ============================================================
        {
            // Lấy 4 phiên cuối
            const lastFour = results.slice(-4)

            // Kiểm tra mẫu AABB hoặc BBAA
            if (lastFour.length === 4) {
                const first = lastFour[0]
                const second = lastFour[1]
                const third = lastFour[2]
                const fourth = lastFour[3]

                // Nếu là mẫu kép
                if (first === second && third === fourth) {
                    // Dự đoán ngược với cặp cuối
                    matchedPatterns.push({
                        name: 'Kép 2-2 mở rộng',
                        prediction: third !== 'T'
                    })
                }
            }
        }


        // ============================================================
        // PATTERN 16: 3-3 (6 phiên AAABBB)
        // ============================================================
        {
            // Lấy 6 phiên cuối
            const lastSix = results.slice(-6)

            // Kiểm tra mẫu 3-3
            if (lastSix.length === 6) {
                // Kiểm tra 3 phiên đầu giống nhau
                const firstThree = lastSix.slice(0, 3)
                const firstVal = firstThree[0]
                let firstSame = true
                for (const r of firstThree) {
                    if (r !== firstVal) {
                        firstSame = false
                        break
                    }
                }

                // Kiểm tra 3 phiên sau giống nhau
                const lastThree = lastSix.slice(3)
                const lastVal = lastThree[0]
                let lastSame = true
                for (const r of lastThree) {
                    if (r !== lastVal) {
                        lastSame = false
                        break
                    }
                }

                // Nếu thỏa mãn mẫu 3-3 và 2 nhóm khác nhau
                if (firstSame && lastSame && firstVal !== lastVal) {
                    // Dự đoán đảo chiều
                    matchedPatterns.push({
                        name: '3-3',
                        prediction: lastVal !== 'T'
                    })
                }
            }
        }


        // ============================================================
        // PATTERN 17: Chu kỳ 2 (4 phiên ABAB)
        // ============================================================
        {
            // Lấy 4 phiên cuối
            const lastFour = results.slice(-4)

            // Kiểm tra mẫu ABAB
            if (lastFour.length === 4) {
                if (lastFour[0] === lastFour[2] && lastFour[1] === lastFour[3] && lastFour[0] !== lastFour[1]) {
                    // Dự đoán tiếp tục chu kỳ
                    matchedPatterns.push({
                        name: 'Chu kỳ 2',
                        prediction: lastFour[3] !== 'T'
                    })
                }
            }
        }


        // ============================================================
        // PATTERN 18: Chu kỳ 3 (6 phiên ABCABC)
        // ============================================================
        {
            // Lấy 6 phiên cuối
            const lastSix = results.slice(-6)

            // Kiểm tra mẫu ABCABC
            if (lastSix.length === 6) {
                if (lastSix[0] === lastSix[3] && lastSix[1] === lastSix[4] && lastSix[2] === lastSix[5]) {
                    // Dự đoán tiếp tục chu kỳ
                    matchedPatterns.push({
                        name: 'Chu kỳ 3',
                        prediction: lastSix[5] !== 'T'
                    })
                }
            }
        }


        // ============================================================
        // PATTERN 19: Lặp 2-1
        // ============================================================
        {
            // Lấy 3 phiên cuối
            const lastThree = results.slice(-3)

            // Kiểm tra mẫu 2-1
            if (lastThree.length === 3) {
                const taiCount = lastThree.filter(function(r) {
                    return r === 'T'
                }).length

                // Nếu có 2 Tài
                if (taiCount === 2) {
                    matchedPatterns.push({
                        name: 'Lặp 2-1',
                        prediction: true
                    })
                }

                // Nếu có 2 Xỉu (1 Tài)
                if (taiCount === 1) {
                    matchedPatterns.push({
                        name: 'Lặp 2-1',
                        prediction: false
                    })
                }
            }
        }


        // ============================================================
        // PATTERN 20: Lặp 3-2
        // ============================================================
        {
            // Lấy 5 phiên cuối
            const lastFive = results.slice(-5)

            // Kiểm tra mẫu 3-2
            if (lastFive.length === 5) {
                const taiCount = lastFive.filter(function(r) {
                    return r === 'T'
                }).length

                // Nếu Tài >= 3 thì dự đoán Xỉu
                if (taiCount >= 3) {
                    matchedPatterns.push({
                        name: 'Lặp 3-2',
                        prediction: false
                    })
                }

                // Nếu Tài <= 2 thì dự đoán Tài
                if (taiCount <= 2) {
                    matchedPatterns.push({
                        name: 'Lặp 3-2',
                        prediction: true
                    })
                }
            }
        }


        // ============================================================
        // PATTERN 21: Đối xứng (5 phiên đối xứng hoàn toàn)
        // ============================================================
        {
            // Lấy 5 phiên cuối
            const lastFive = results.slice(-5)

            // Kiểm tra đối xứng
            if (lastFive.length === 5) {
                // Kiểm tra vị trí 0 và 4, 1 và 3
                if (lastFive[0] === lastFive[4] && lastFive[1] === lastFive[3]) {
                    // Dự đoán ngược với vị trí giữa
                    matchedPatterns.push({
                        name: 'Đối xứng',
                        prediction: lastFive[2] !== 'T'
                    })
                }
            }
        }


        // ============================================================
        // PATTERN 22: Bán đối xứng (5 phiên khớp >= 4)
        // ============================================================
        {
            // Lấy 5 phiên cuối
            const lastFive = results.slice(-5)

            // Kiểm tra bán đối xứng
            if (lastFive.length === 5) {
                // Đếm số vị trí khớp đối xứng
                let matchCount = 0

                // So sánh từng cặp đối xứng
                for (let i = 0; i < 5; i++) {
                    if (lastFive[i] === lastFive[4 - i]) {
                        matchCount = matchCount + 1
                    }
                }

                // Nếu khớp >= 4 vị trí
                if (matchCount >= 4) {
                    // Dự đoán ngược với vị trí giữa
                    matchedPatterns.push({
                        name: 'Bán đối xứng',
                        prediction: lastFive[2] !== 'T'
                    })
                }
            }
        }


        // ============================================================
        // PATTERN 23: Bệt ngược
        // ============================================================
        {
            // Lấy streak hiện tại
            const streakLen = this.getStreak(results)

            // Nếu streak >= 6
            if (streakLen >= 6) {
                // Lấy kết quả cuối
                const lastValue = results[results.length - 1]

                // Dự đoán đảo chiều
                matchedPatterns.push({
                    name: 'Bệt ngược',
                    prediction: lastValue !== 'T'
                })
            }
        }


        // ============================================================
        // PATTERN 24: Xỉu kép
        // ============================================================
        {
            // Lấy 2 phiên cuối
            const lastTwo = results.slice(-2)

            // Kiểm tra 2 phiên Xỉu liên tiếp
            if (lastTwo.length === 2 && lastTwo[0] === 'X' && lastTwo[1] === 'X') {
                // Dự đoán tiếp tục Xỉu
                matchedPatterns.push({
                    name: 'Xỉu kép',
                    prediction: false
                })
            }
        }


        // ============================================================
        // PATTERN 25: Tài kép
        // ============================================================
        {
            // Lấy 2 phiên cuối
            const lastTwo = results.slice(-2)

            // Kiểm tra 2 phiên Tài liên tiếp
            if (lastTwo.length === 2 && lastTwo[0] === 'T' && lastTwo[1] === 'T') {
                // Dự đoán tiếp tục Tài
                matchedPatterns.push({
                    name: 'Tài kép',
                    prediction: true
                })
            }
        }


        // ============================================================
        // PATTERN 26: Xen kẽ
        // ============================================================
        {
            // Lấy 7 phiên cuối
            const lastSeven = results.slice(-7)

            // Kiểm tra xen kẽ hoàn toàn
            if (lastSeven.length === 7) {
                // Biến kiểm tra
                let alternating = true

                // Kiểm tra từng cặp
                for (let i = 0; i < 6; i++) {
                    if (lastSeven[i] === lastSeven[i + 1]) {
                        alternating = false
                        break
                    }
                }

                // Nếu xen kẽ hoàn toàn
                if (alternating) {
                    // Dự đoán tiếp tục xen kẽ
                    matchedPatterns.push({
                        name: 'Xen kẽ',
                        prediction: lastSeven[6] !== 'T'
                    })
                }
            }
        }


        // ============================================================
        // PATTERN 27: Gập ghềnh
        // ============================================================
        {
            // Nếu >= 6 Tài trong 10 phiên cuối
            if (taiCount10 >= 6) {
                matchedPatterns.push({
                    name: 'Gập ghềnh',
                    prediction: true
                })
            } else if (taiCount10 <= 4) {
                matchedPatterns.push({
                    name: 'Gập ghềnh',
                    prediction: false
                })
            }
        }


        // ============================================================
        // PATTERN 28: Bậc thang
        // ============================================================
        {
            // Dự đoán ngược với kết quả cuối
            matchedPatterns.push({
                name: 'Bậc thang',
                prediction: lastResult !== 'T'
            })
        }


        // ============================================================
        // PATTERN 29: Gãy ngang
        // ============================================================
        {
            // Dự đoán ngược với kết quả cuối
            matchedPatterns.push({
                name: 'Gãy ngang',
                prediction: lastResult !== 'T'
            })
        }


        // ============================================================
        // PATTERN 30: Cầu đôi
        // ============================================================
        {
            // Dự đoán ngược với kết quả cuối
            matchedPatterns.push({
                name: 'Cầu đôi',
                prediction: lastResult !== 'T'
            })
        }


        // ============================================================
        // PATTERN 31: Đa dạng
        // ============================================================
        {
            // Nếu >= 5 Tài trong 10 phiên cuối
            if (taiCount10 >= 5) {
                matchedPatterns.push({
                    name: 'Đa dạng',
                    prediction: true
                })
            } else {
                matchedPatterns.push({
                    name: 'Đa dạng',
                    prediction: false
                })
            }
        }


        // ============================================================
        // PATTERN 32: Chu kỳ tăng
        // ============================================================
        {
            // Dự đoán ngược với kết quả cuối
            matchedPatterns.push({
                name: 'Chu kỳ tăng',
                prediction: lastResult !== 'T'
            })
        }


        // ============================================================
        // PATTERN 33: Chu kỳ giảm
        // ============================================================
        {
            // Dự đoán ngược với kết quả cuối
            matchedPatterns.push({
                name: 'Chu kỳ giảm',
                prediction: lastResult !== 'T'
            })
        }


        // ============================================================
        // PATTERN 34: Cầu lặp
        // ============================================================
        {
            // Lấy 6 phiên cuối
            const lastSix = results.slice(-6)

            // Dự đoán giống phiên đầu tiên trong 6 phiên
            if (lastSix.length > 0) {
                const firstOfSix = lastSix[0]

                // Thêm pattern
                matchedPatterns.push({
                    name: 'Cầu lặp',
                    prediction: firstOfSix === 'T'
                })
            }
        }


        // ============================================================
        // PATTERN 35: Đối ngược
        // ============================================================
        {
            // Dự đoán ngược với kết quả cuối
            matchedPatterns.push({
                name: 'Đối ngược',
                prediction: lastResult !== 'T'
            })
        }


        // ============================================================
        // PATTERN 36: Phân cụm
        // ============================================================
        {
            // Nếu > 5 Tài trong 10 phiên cuối
            if (taiCount10 > 5) {
                matchedPatterns.push({
                    name: 'Phân cụm',
                    prediction: true
                })
            } else if (taiCount10 < 5) {
                matchedPatterns.push({
                    name: 'Phân cụm',
                    prediction: false
                })
            }
        }


        // ============================================================
        // PATTERN 37: Lệch ngẫu nhiên
        // ============================================================
        {
            // Nếu >= 5 Tài trong 10 phiên cuối
            if (taiCount10 >= 5) {
                matchedPatterns.push({
                    name: 'Lệch ngẫu nhiên',
                    prediction: true
                })
            } else {
                matchedPatterns.push({
                    name: 'Lệch ngẫu nhiên',
                    prediction: false
                })
            }
        }


        // ============================================================
        // PATTERN 38: Xen kẽ dài
        // ============================================================
        {
            // Dự đoán ngược với kết quả cuối
            matchedPatterns.push({
                name: 'Xen kẽ dài',
                prediction: lastResult !== 'T'
            })
        }


        // ============================================================
        // PATTERN 39: Cầu gập
        // ============================================================
        {
            // Dự đoán ngược với kết quả cuối
            matchedPatterns.push({
                name: 'Cầu gập',
                prediction: lastResult !== 'T'
            })
        }


        // ============================================================
        // PATTERN 40: Xỉu lắc
        // ============================================================
        {
            // Dự đoán ngược với kết quả cuối
            matchedPatterns.push({
                name: 'Xỉu lắc',
                prediction: lastResult !== 'T'
            })
        }


        // ============================================================
        // PATTERN 41: Tài lắc
        // ============================================================
        {
            // Dự đoán ngược với kết quả cuối
            matchedPatterns.push({
                name: 'Tài lắc',
                prediction: lastResult !== 'T'
            })
        }


        // ============================================================
        // PATTERN 42: Phối hợp 1
        // ============================================================
        {
            // Nếu > 5 Tài trong 10 phiên cuối
            if (taiCount10 > 5) {
                matchedPatterns.push({
                    name: 'Phối hợp 1',
                    prediction: true
                })
            } else {
                matchedPatterns.push({
                    name: 'Phối hợp 1',
                    prediction: false
                })
            }
        }


        // ============================================================
        // PATTERN 43: Phối hợp 2
        // ============================================================
        {
            // Dùng quick analysis
            matchedPatterns.push({
                name: 'Phối hợp 2',
                prediction: qa.prediction
            })
        }


        // ============================================================
        // PATTERN 44: Phối hợp 3
        // ============================================================
        {
            // Dùng quick analysis
            matchedPatterns.push({
                name: 'Phối hợp 3',
                prediction: qa.prediction
            })
        }


        // ============================================================
        // PATTERN 45: Chẵn lẻ lặp
        // ============================================================
        {
            // Dự đoán ngược với kết quả cuối
            matchedPatterns.push({
                name: 'Chẵn lẻ lặp',
                prediction: lastResult !== 'T'
            })
        }


        // ============================================================
        // PATTERN 46: Dài ngắn đảo
        // ============================================================
        {
            // Dự đoán ngược với kết quả cuối
            matchedPatterns.push({
                name: 'Dài ngắn đảo',
                prediction: lastResult !== 'T'
            })
        }


        // ============================================================
        // PATTERN 47: Ngẫu nhiên bệt
        // ============================================================
        {
            // Dự đoán giống kết quả cuối
            matchedPatterns.push({
                name: 'Ngẫu nhiên bệt',
                prediction: lastResult === 'T'
            })
        }


        // ============================================================
        // TÍNH ĐIỂM CHO TỪNG PATTERN
        // ============================================================

        // Mảng kết quả đã tính điểm
        const scoredPatterns = []

        // Duyệt qua từng pattern khớp
        for (const pattern of matchedPatterns) {
            // Lấy thống kê thành công
            const successCount = this.patternSuccessCount[pattern.name] || 0

            // Lấy thống kê thất bại
            const failCount = this.patternFailCount[pattern.name] || 0

            // Tổng số lần thử
            const totalAttempts = successCount + failCount

            // Tính success rate
            let successRate = 0.5
            if (totalAttempts > 0) {
                successRate = successCount / totalAttempts
            }

            // Tính recent match rate (mặc định 0.5)
            const recentMatchRate = 0.5

            // Tính score = successRate * 0.7 + recentMatchRate * 0.3
            const score = clamp(successRate * 0.7 + recentMatchRate * 0.3, 0.25, 0.98)

            // Thêm vào mảng kết quả
            scoredPatterns.push({
                name: pattern.name,
                score: score,
                prediction: pattern.prediction,
                successRate: successRate
            })
        }

        // Sắp xếp theo score giảm dần
        scoredPatterns.sort(function(a, b) {
            return b.score - a.score
        })

        // Trả về mảng pattern đã sắp xếp
        return scoredPatterns
    }


    // ============================================================
    // PREDICT
    // ============================================================

    /**
     * Hàm predict() — dự đoán kết quả Tài/Xỉu
     * 4 nhánh: warmup, strong, medium, fallback
     */
    predict(sessionData) {
        // Bọc trong try-catch
        try {
            // === NHÁNH 1: WARMUP (< MIN_S phiên) ===
            if (this.history.length < this.MIN_S) {
                // Lấy kết quả cuối cùng nếu có
                const last = this.history.length > 0
                    ? this.history[this.history.length - 1].result
                    : null

                // Biến dự đoán
                let prediction

                // Dự đoán dựa trên kết quả cuối
                if (last === 'T') {
                    // 52% tiếp tục Tài
                    prediction = Math.random() < 0.52
                } else if (last === 'X') {
                    // 48% chuyển sang Tài
                    prediction = Math.random() < 0.48
                } else {
                    // 50/50
                    prediction = Math.random() < 0.5
                }

                // Lưu dự đoán
                this.lastPrediction = prediction

                // Trả về kết quả warmup
                return {
                    prediction: prediction ? 'T' : 'X',
                    confidence: 50,
                    method: 'warmup',
                    reason: 'Chưa đủ dữ liệu, dùng warmup'
                }
            }

            // === PHÂN TÍCH PATTERN ===
            const analyzed = this.analyzeAllPatterns()

            // === NHÁNH 2: STRONG (> 0.72) - ĐẢO BOOLEAN ===
            if (analyzed.length > 0 && analyzed[0].score > 0.72) {
                // Lấy pattern tốt nhất
                const best = analyzed[0]

                // ĐẢO boolean
                const invertedPrediction = !best.prediction

                // Confidence clamp [0.4, 0.6]
                const confidence = clamp(best.score, 0.4, 0.6)

                // Lưu dự đoán
                this.lastPrediction = invertedPrediction

                // Log
                log('INFO', '[MD5] Strong: ' + best.name + ' score=' + best.score.toFixed(3) + ' -> ' + (invertedPrediction ? 'T' : 'X'))

                // Trả về kết quả
                return {
                    prediction: invertedPrediction ? 'T' : 'X',
                    confidence: Math.round(confidence * 100),
                    method: 'strong_inverted',
                    pattern: best.name
                }
            }

            // === NHÁNH 3: MEDIUM (> 0.55) ===
            if (analyzed.length > 0 && analyzed[0].score > 0.55) {
                // Lấy pattern tốt nhất
                const best = analyzed[0]

                // Điều chỉnh score
                const adjustedScore = best.prediction ? best.score : (1 - best.score)

                // Kết hợp pattern score và success rate
                const combinedScore = adjustedScore * 0.6 + best.successRate * 0.4

                // Dự đoán
                const prediction = combinedScore >= 0.5

                // Confidence clamp
                const confidence = clamp(combinedScore, 0.4, 0.6)

                // Lưu dự đoán
                this.lastPrediction = prediction

                // Log
                log('INFO', '[MD5] Medium: ' + best.name + ' score=' + best.score.toFixed(3) + ' -> ' + (prediction ? 'T' : 'X'))

                // Trả về kết quả
                return {
                    prediction: prediction ? 'T' : 'X',
                    confidence: Math.round(confidence * 100),
                    method: 'medium_combined',
                    pattern: best.name
                }
            }

            // === NHÁNH 4: FALLBACK NEURAL NETWORK ===
            // Lấy quick analysis
            const qa = getQuickAnalysis(this.history)

            // Lấy 10 phiên cuối
            const recent10 = getLastN(this.history, 10)
            const results10 = recent10.map(function(s) {
                return s.result
            })

            // Tính fallback score
            let fallbackScore = 0.5
            if (results10.length >= 6) {
                // Đếm số cặp khác nhau
                let diffCount = 0
                for (let i = 0; i < results10.length - 1; i++) {
                    if (results10[i] !== results10[i + 1]) {
                        diffCount = diffCount + 1
                    }
                }

                // Tỉ lệ khác nhau
                const diffRate = diffCount / Math.max(results10.length - 1, 1)

                // Lấy kết quả cuối
                const lastResult10 = results10[results10.length - 1]

                // Dự đoán
                const rawPrediction = diffRate > 0.6 ? (lastResult10 !== 'T') : (lastResult10 === 'T')
                const rawScore = clamp(diffRate, 0.4, 0.9)

                // Tính fallback score
                if (rawPrediction) {
                    fallbackScore = rawScore
                } else {
                    fallbackScore = 1 - rawScore
                }
            }

            // Neural network forward
            const neuralScore = forward(
                [calcProb(qa.prediction, qa.confidence), fallbackScore, 0.5],
                this.weights,
                this.bias
            )

            // MD5 fallback: >= 0.5 → Tài
            const prediction = neuralScore >= 0.5

            // Confidence clamp
            const confidence = clamp(neuralScore, 0.4, 0.6)

            // Lưu dự đoán
            this.lastPrediction = prediction

            // Log
            log('INFO', '[MD5] Fallback: ns=' + neuralScore.toFixed(3) + ' -> ' + (prediction ? 'T' : 'X'))

            // Trả về kết quả
            return {
                prediction: prediction ? 'T' : 'X',
                confidence: Math.round(confidence * 100),
                method: 'neural_fallback'
            }

        } catch (err) {
            // Log lỗi
            log('ERROR', '[MD5] Lỗi predict: ' + err.message)

            // Dự đoán mặc định 50/50
            const prediction = Math.random() < 0.5
            this.lastPrediction = prediction

            // Trả về kết quả lỗi
            return {
                prediction: prediction ? 'T' : 'X',
                confidence: 50,
                method: 'error_fallback'
            }
        }
    }


    /**
     * Thêm kết quả thực tế vào lịch sử
     */
    addResult(resultInput, sessionData) {
        // Bọc trong try-catch
        try {
            // Chuẩn hóa kết quả
            const result = normalizeResult(resultInput)

            // Tạo timestamp
            const timestamp = (sessionData && sessionData.timestamp) ? sessionData.timestamp : Date.now()

            // Thêm phiên vào lịch sử
            this.history.push({
                sessionId: sessionData ? sessionData.sessionId : 'unknown',
                result: result,
                total: sessionData ? sessionData.total : null,
                timestamp: timestamp
            })

            // Giới hạn lịch sử
            if (this.history.length > MAX_H) {
                this.history.shift()
            }

            // Cập nhật thời gian giữa các phiên
            if (this.history.length >= 2) {
                const last = this.history[this.history.length - 1]
                const prev = this.history[this.history.length - 2]
                const delta = (last.timestamp - prev.timestamp) / 1000
                this.y.push(delta)
                if (this.y.length > 20) {
                    this.y.shift()
                }
            }

            // Cập nhật thống kê
            this.stats.totalSessions = this.stats.totalSessions + 1

            // Cập nhật đếm Tài/Xỉu
            if (result === 'T') {
                this.stats.totalTai = this.stats.totalTai + 1
            } else {
                this.stats.totalXiu = this.stats.totalXiu + 1
            }

            // Cập nhật streak
            if (this.stats.currentStreakType === result) {
                this.stats.currentStreakCount = this.stats.currentStreakCount + 1
            } else {
                this.stats.currentStreakType = result
                this.stats.currentStreakCount = 1
            }

            // Cập nhật streak dài nhất
            if (result === 'T' && this.stats.currentStreakCount > this.stats.longestTaiStreak) {
                this.stats.longestTaiStreak = this.stats.currentStreakCount
            }
            if (result === 'X' && this.stats.currentStreakCount > this.stats.longestXiuStreak) {
                this.stats.longestXiuStreak = this.stats.currentStreakCount
            }

            // So sánh với dự đoán cuối
            if (this.lastPrediction !== null) {
                // Lấy dự đoán dạng T/X
                const predicted = this.lastPrediction ? 'T' : 'X'

                // Kiểm tra đúng/sai
                const isCorrect = predicted === result

                // Thêm vào prediction log
                const logEntry = {
                    phien: String(sessionData ? sessionData.sessionId : ''),
                    xuc_xac: sessionData ? (sessionData.dice || '') : '',
                    tong: sessionData ? (sessionData.total || 0) : 0,
                    ket_qua: result === 'T' ? 'Tài' : 'Xỉu',
                    du_doan: predicted === 'T' ? 'Tài' : 'Xỉu',
                    danh_gia: isCorrect ? '✅ ĐÚNG' : '❌ SAI',
                    do_tin_cay: '0%',
                    timestamp: new Date().toISOString()
                }

                // Thêm vào mảng
                this.predictionLog.push(logEntry)

                // Giới hạn prediction log
                if (this.predictionLog.length > MAX_H) {
                    this.predictionLog.shift()
                }

                // Cập nhật thống kê đúng/sai
                if (isCorrect) {
                    this.stats.correctPredictions = this.stats.correctPredictions + 1
                } else {
                    this.stats.wrongPredictions = this.stats.wrongPredictions + 1
                }
            }

        } catch (err) {
            // Log lỗi
            log('ERROR', '[MD5] Lỗi addResult: ' + err.message)
        }
    }


    /**
     * Lấy danh sách dự đoán gần đây
     */
    getPredictionLog(limit) {
        // Lấy số lượng cần lấy
        const count = limit || 50

        // Lấy các dự đoán gần nhất
        const log = this.predictionLog.slice(-count)

        // Đảo ngược để hiển thị mới nhất trước
        log.reverse()

        // Trả về kết quả
        return log
    }


    /**
     * Lấy độ chính xác
     */
    getAccuracy() {
        // Tổng số phiên
        const total = this.stats.totalSessions

        // Nếu chưa có phiên nào
        if (total === 0) {
            return '0.0%'
        }

        // Tính phần trăm đúng
        const percent = (this.stats.correctPredictions / total * 100)
        return percent.toFixed(1) + '%'
    }


    /**
     * Lấy thời gian chạy
     */
    getRuntime() {
        // Tính thời gian đã chạy
        const elapsed = Date.now() - this.stats.startTime

        // Format và trả về
        return timeStr(elapsed)
    }

} // Kết thúc class PredictionEngine


// ============================================================
// WEBSOCKET CLIENT
// ============================================================

// Biến đếm số lần reconnect
let reconnectAttempts = 0

/**
 * Kết nối WebSocket và xử lý sự kiện
 */
function connectWebSocket() {
    // Log bắt đầu kết nối
    log('INFO', 'Đang kết nối WebSocket...')

    // Bọc trong try-catch
    try {
        // Tạo kết nối WebSocket
        const ws = new WebSocket(WS_URL, { rejectUnauthorized: false })

        // Biến lưu interval ping
        let pingInterval = null

        // Xử lý khi kết nối thành công
        ws.on('open', function() {
            // Log kết nối thành công
            log('INFO', 'WebSocket CONNECTED!')

            // Reset số lần reconnect
            reconnectAttempts = 0

            // Đăng ký hub
            const registerMsg = JSON.stringify({
                H: HUB_NAME,
                M: 'Register',
                A: [],
                I: 0
            })

            // Gửi đăng ký
            ws.send(registerMsg + '\n')

            // Log đã gửi đăng ký
            log('INFO', 'Đã gửi đăng ký hub: ' + HUB_NAME)

            // Gửi ping mỗi 10 giây để giữ kết nối
            pingInterval = setInterval(function() {
                // Kiểm tra kết nối còn mở
                if (ws.readyState === WebSocket.OPEN) {
                    // Gửi ping
                    ws.send(JSON.stringify({
                        H: HUB_NAME,
                        M: 'Ping',
                        A: [],
                        I: 0
                    }) + '\n')
                }
            }, 10000)
        })

        // Xử lý khi nhận message
        ws.on('message', function(data) {
            try {
                // Parse message (có thể có nhiều message)
                const messages = data.toString().split('\n')

                // Duyệt qua từng message
                for (const msg of messages) {
                    // Bỏ qua message rỗng
                    if (!msg.trim()) {
                        continue
                    }

                    // Parse JSON
                    const parsed = JSON.parse(msg)

                    // Kiểm tra loại message
                    if (parsed.M === 'Md5sessionInfo' && parsed.A && parsed.A.length > 0) {
                        // Lấy dữ liệu phiên
                        const sd = parsed.A[0]

                        // Kiểm tra phiên đã có kết quả
                        if (sd.CurrentState === 1 && sd.Dice1 > 0) {
                            // Lấy giá trị xúc xắc
                            const dice1 = sd.Dice1 || 0
                            const dice2 = sd.Dice2 || 0
                            const dice3 = sd.Dice3 || 0

                            // Tính tổng
                            const total = dice1 + dice2 + dice3

                            // Xác định Tài/Xỉu
                            const result = total >= 11 ? 'Tài' : 'Xỉu'

                            // Lấy session ID
                            const sessionId = sd.SessionId || 0

                            // Log phiên
                            log('INFO', '[WS] Phiên #' + sessionId + ': ' + dice1 + '-' + dice2 + '-' + dice3 + ' = ' + total + ' → ' + result)

                            // Thêm kết quả vào engine
                            engine.addResult(result, {
                                sessionId: sessionId,
                                total: total,
                                dice: dice1 + '-' + dice2 + '-' + dice3,
                                timestamp: Date.now()
                            })

                            // Dự đoán cho phiên tiếp theo
                            const prediction = engine.predict({
                                sessionId: sessionId + 1,
                                timestamp: Date.now()
                            })

                            // In box kết quả ra console
                            console.log('')
                            console.log('┌──────────────────────────────────────────┐')
                            console.log('│ #' + String(sessionId).padEnd(35) + '│')
                            console.log('│ 🎲 [' + dice1 + ',' + dice2 + ',' + dice3 + '] = ' + total + ' → ' + result + ' '.repeat(Math.max(0, 20 - result.length)) + '│')
                            console.log('│ 🔮 DỰ ĐOÁN: ' + (prediction.prediction === 'T' ? 'TÀI' : 'XỈU') + ' (' + prediction.confidence + '%)' + ' '.repeat(Math.max(0, 15)) + '│')
                            console.log('│ 📊 ' + engine.stats.totalSessions + ' phiên | 🎯 ' + engine.getAccuracy() + ' | ⚡ ' + engine.getRuntime() + ' '.repeat(Math.max(0, 5)) + '│')
                            console.log('└──────────────────────────────────────────┘')
                            console.log('')
                        }
                    }
                }
            } catch (err) {
                // Bỏ qua message lỗi
            }
        })

        // Xử lý khi kết nối đóng
        ws.on('close', function() {
            // Xóa ping interval
            if (pingInterval) {
                clearInterval(pingInterval)
            }

            // Tính thời gian reconnect
            const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 30000)

            // Tăng số lần reconnect
            reconnectAttempts = reconnectAttempts + 1

            // Log
            log('WARN', 'WebSocket đóng, reconnect sau ' + Math.round(delay / 1000) + 's')

            // Reconnect sau delay
            setTimeout(connectWebSocket, delay)
        })

        // Xử lý lỗi
        ws.on('error', function(err) {
            // Log lỗi
            log('ERROR', 'WebSocket lỗi: ' + err.message)
        })

    } catch (err) {
        // Log lỗi kết nối
        log('ERROR', 'Lỗi kết nối WebSocket: ' + err.message)

        // Thử lại sau 5 giây
        setTimeout(connectWebSocket, 5000)
    }
}


// ============================================================
// API SERVER
// ============================================================

/**
 * Tạo HTTP server cho API
 */
const server = http.createServer(function(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    // Xử lý OPTIONS request
    if (req.method === 'OPTIONS') {
        res.writeHead(200)
        res.end()
        return
    }

    // Parse URL
    const url = new URL(req.url, 'http://localhost:' + API_PORT)
    const pathname = url.pathname

    // Bọc trong try-catch
    try {
        // === GET /health ===
        if (req.method === 'GET' && pathname === '/health') {
            // Tạo response
            const response = {
                status: 'running',
                version: '1.0.0',
                engine: 'MD5',
                runtime: engine.getRuntime(),
                sessions: engine.stats.totalSessions,
                accuracy: engine.getAccuracy()
            }

            // Trả về JSON
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(response))
            return
        }

        // === GET /api/predict ===
        if (req.method === 'GET' && pathname === '/api/predict') {
            // Gọi predict
            const prediction = engine.predict({})

            // Tạo response
            const response = {
                success: true,
                prediction: prediction.prediction === 'T' ? 'Tài' : 'Xỉu',
                confidence: prediction.confidence,
                method: prediction.method,
                reason: prediction.reason || ''
            }

            // Trả về JSON
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(response))
            return
        }

        // === GET /api/stats ===
        if (req.method === 'GET' && pathname === '/api/stats') {
            // Tạo response
            const response = {
                totalSessions: engine.stats.totalSessions,
                totalTai: engine.stats.totalTai,
                totalXiu: engine.stats.totalXiu,
                correctPredictions: engine.stats.correctPredictions,
                wrongPredictions: engine.stats.wrongPredictions,
                accuracy: engine.getAccuracy(),
                runtime: engine.getRuntime(),
                longestTaiStreak: engine.stats.longestTaiStreak,
                longestXiuStreak: engine.stats.longestXiuStreak,
                currentStreak: (engine.stats.currentStreakType || 'N/A') + ' x' + engine.stats.currentStreakCount
            }

            // Trả về JSON
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(response))
            return
        }

        // === GET /api/prediction_log ===
        if (req.method === 'GET' && pathname === '/api/prediction_log') {
            // Lấy limit từ query string
            const limit = parseInt(url.searchParams.get('limit') || '50')

            // Lấy log dự đoán
            const log = engine.getPredictionLog(limit)

            // Trả về JSON
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(log))
            return
        }

        // === GET / ===
        if (req.method === 'GET' && (pathname === '/' || pathname === '')) {
            // Lấy stats
            const s = engine.stats

            // Tạo HTML
            const html = '<!DOCTYPE html>\n' +
                '<html>\n' +
                '<head>\n' +
                '<meta charset="utf-8">\n' +
                '<title>XocDia88 - MD5</title>\n' +
                '<meta http-equiv="refresh" content="5">\n' +
                '<style>\n' +
                'body { font-family: monospace; background: #0a0a0a; color: #0f0; padding: 20px; }\n' +
                '.box { border: 1px solid #0f0; padding: 15px; margin: 10px 0; }\n' +
                'h1 { color: #0ff; }\n' +
                '.correct { color: #0f0; }\n' +
                '.wrong { color: #f00; }\n' +
                '</style>\n' +
                '</head>\n' +
                '<body>\n' +
                '<h1>🎲 XocDia88 - Engine MD5</h1>\n' +
                '<div class="box">\n' +
                '<p>📊 Tổng phiên: <b>' + s.totalSessions + '</b></p>\n' +
                '<p>📈 Độ chính xác: <b>' + engine.getAccuracy() + '</b></p>\n' +
                '<p>✅ Dự đoán đúng: <span class="correct">' + s.correctPredictions + '</span></p>\n' +
                '<p>❌ Dự đoán sai: <span class="wrong">' + s.wrongPredictions + '</span></p>\n' +
                '<p>⏱️ Thời gian chạy: ' + engine.getRuntime() + '</p>\n' +
                '<p>🔥 Streak hiện tại: ' + (s.currentStreakType || 'N/A') + ' x' + s.currentStreakCount + '</p>\n' +
                '</div>\n' +
                '<div class="box">\n' +
                '<h2>API Endpoints</h2>\n' +
                '<p>GET /health - Trạng thái server</p>\n' +
                '<p>GET /api/predict - Dự đoán phiên tiếp theo</p>\n' +
                '<p>GET /api/stats - Thống kê chi tiết</p>\n' +
                '<p>GET /api/prediction_log?limit=50 - Log dự đoán</p>\n' +
                '</div>\n' +
                '<p>🕐 Server time: ' + new Date().toISOString() + '</p>\n' +
                '</body>\n' +
                '</html>'

            // Trả về HTML
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(html)
            return
        }

        // === 404 ===
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not found', path: pathname }))

    } catch (err) {
        // Log lỗi
        log('ERROR', 'API Error: ' + err.message)

        // Trả về lỗi 500
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
    }
})


// ============================================================
// KHỞI TẠO VÀ CHẠY
// ============================================================

// Tạo engine
const engine = new PredictionEngine()

// Tạo thư mục data
ensureDir()

// Kết nối WebSocket
connectWebSocket()

// Tự động lưu dữ liệu mỗi 5 phút
setInterval(function() {
    // Lưu history
    engine.saveHistory()

    // Lưu prediction log
    engine.savePredictionLog()

    // Log
    log('INFO', 'Đã tự động lưu dữ liệu')
}, SAVE_MS)

// Khởi động API server
server.listen(API_PORT, function() {
    // In banner khởi động
    console.log('')
    console.log('╔══════════════════════════════════════╗')
    console.log('║        🎲 XocDia88 - Engine MD5     ║')
    console.log('║        Server đã khởi động!          ║')
    console.log('╠══════════════════════════════════════╣')
    console.log('║  API: http://localhost:' + String(API_PORT).padEnd(28) + '║')
    console.log('║  Health: http://localhost:' + String(API_PORT).padEnd(21) + '/health ║')
    console.log('╚══════════════════════════════════════╝')
    console.log('')
})

// Xử lý tắt server
process.on('SIGINT', function() {
    // Log
    console.log('')
    log('INFO', 'Đang tắt server...')

    // Lưu dữ liệu
    engine.saveHistory()
    engine.savePredictionLog()

    // Log tạm biệt
    log('INFO', 'Đã lưu dữ liệu. Tạm biệt!')

    // Thoát
    process.exit(0)
})

