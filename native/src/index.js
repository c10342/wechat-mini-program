import { Application } from "./core/application/application"
import { Device } from "./core/device/device"
import { Home } from "./pages/home/home"


window.addEventListener('load',()=>{
    // 初始化模拟应用设备
    const device = new Device()
    // 初始化模拟微信应用
    const app = new Application()
    device.open(app)
    const home = new Home()
    app.initRootView(home)
})