
// 消息管理

import message from "../message";

class MessageManager{
    constructor(){
        this.message = message;
    }

    init(){
        this.message.receive('test',(e)=>{
            console.log(e);
        })

        this.message.send({
            type:'a',
            body:{
                a:'我是来自逻辑线程的消息'
            }
        })
    }
}

export default new MessageManager()