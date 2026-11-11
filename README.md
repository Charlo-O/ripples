# 纸上涟漪

一张可以写字的水面纸笺。输入文字时泛起涟漪，支持六种纸色、印章和音效。

在线使用：<https://charlo.cn/ripples/>

GitHub Pages 入口：<https://charlo-o.github.io/ripples/>（继承账号已有的 `charlo.cn` 域名，会跳转到该域名）。

## 本地运行

在项目目录运行：

```sh
python -m http.server 8000
```

打开 <http://localhost:8000>。无需安装依赖或构建。

## 发布

GitHub Pages 从 `main` 分支根目录发布。推送更新后，GitHub 会自动重新部署。
`.nojekyll` 用于直接发布静态文件。

## 文件

- `index.html`：页面与样式。
- `app.js`：WebGL 涟漪、文字编辑、纸张和音效交互。
- `sfx.js`：内嵌音效数据；文件注释标注来源为 CC0 Freesound 素材。
- `fonts/HuiwenMincho.ttf`：汇文明朝体。
- `tools/prep_sfx.py`：从原始音频生成音效数据，需要另外准备原始素材和 FFmpeg；使用网页时无需运行。

页面默认文字引用朱熹《观书有感》。纸色与音效偏好保存在当前浏览器；输入的文字不会上传到服务器。
