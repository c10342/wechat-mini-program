import axios from 'axios';

// 读取小程序资源文件内容
export function readFile(filePath) {
	return new Promise((resolve, reject) => {
		axios.get('/mini_resource/' + filePath, {responseType: 'text'}).then((res) => {
			resolve(res.data);
		});
	});
}

// 合并小程序配置，全局配置和页面配置
export function mergePageConfig(appConfig, pageConfig) {
	const result = {};
	const appWindowConfig = appConfig.window || {};
	const pagePrivateConfig = pageConfig || {};

	result.navigationBarTitleText = pagePrivateConfig.navigationBarTitleText || appWindowConfig.navigationBarTitleText || '';
	result.navigationBarBackgroundColor = pagePrivateConfig.navigationBarBackgroundColor || appWindowConfig.navigationBarBackgroundColor || '#000';
	result.navigationBarTextStyle = pagePrivateConfig.navigationBarTextStyle || appWindowConfig.navigationBarTextStyle || 'white';
	result.backgroundColor = pagePrivateConfig.backgroundColor || appWindowConfig.backgroundColor || '#fff';
	result.navigationStyle = pagePrivateConfig.navigationStyle || appWindowConfig.navigationStyle || 'default';

	return result;
}