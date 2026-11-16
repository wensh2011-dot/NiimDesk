<div dir="rtl">

# NiimDesk — نسخة الكمبيوتر

برنامج **مجاني ومفتوح المصدر** لتصميم وطباعة الملصقات على طابعات **NIIMBOT** من كمبيوتر Windows، ويدعم العربي والإنجليزي.

> ⚠️ NiimDesk مشروع مستقل، **غير تابع لشركة NIIMBOT ولا معتمد منها**. "NIIMBOT" علامة تجارية مملوكة لأصحابها.

![NiimDesk](docs/screenshot.png)

## ⬇️ التحميل

1. نزّل **NiimDesk.exe** من صفحة [الإصدارات (Releases)](../../releases/latest).
2. دبل كليك على الملف. ما محتاج تنصيب.
3. وصّل الطابعة بالكمبيوتر **بكابل USB**، واضغط **اتصال بالطابعة ← كابل USB**.

> **رسالة Windows الزرقاء:** الملف غير موقّع رقمياً، فممكن Windows يعرض رسالة "Windows protected your PC". اضغط **More info** وبعدها **Run anyway**. الكود كله موجود هنا، وتقدر تراجعه أو تبني الملف براك.

**المتطلبات:** Windows 10 أو 11، ومتصفح **Microsoft Edge** أو **Google Chrome** (البرنامج بيفتح فيهم كشباك مستقل).

## ✨ المميزات

- **محرر سهل:** سحب وإفلات، تكبير وتصغير، تدوير، قفل، تراجع وإعادة، ومحاذاة تلقائية.
- **العناصر:** نص عربي وإنجليزي، تاريخ إنتاج وانتهاء تلقائي، أيقونات، إطار، خط، جدول، صور، QR، باركود (CODE128 و EAN13 وغيرها)، وترقيم تسلسلي.
- **صفحات متعددة:** أكتر من ملصق في نفس الملف، وتطبعهم مع بعض.
- **طباعة جماعية من Excel:** اربط أعمدة الملف بالملصق، والبرنامج يطبع ملصق لكل صف.
- **قوالب جاهزة:** سعر، عرض خاص، صلاحية، أسماء، ملفات، كابلات، وغيرها.
- **سجل الطباعة:** تعيد طباعة أي ملصق قديم بضغطة.
- **نسخة احتياطية:** كل القوالب والإعدادات في ملف واحد.
- **يشتغل من غير إنترنت.** كل البيانات بتتحفظ في جهازك بس.

## 🖨️ الطابعات

البرنامج اتجرّب على **NIIMBOT D11_H** بكابل USB. وغالباً بيشتغل مع الطابعات التانية المدعومة في مكتبة [niimbluelib](https://github.com/MultiMote/niimbluelib) زي D11 و D110 و B1 و B21 وغيرها.

**بالنسبة للبلوتوث:** في الطابعة الاتجرّبت، الطباعة بالبلوتوث من الكمبيوتر بتطلّع الورق فاضي، وده بيحصل كمان مع موقع niim.blue. عشان كده **الكابل هو الطريقة المضمونة**.

</div>

---

## English

**NiimDesk** is a free, open-source label designer for **NIIMBOT** label printers on Windows, with full Arabic (RTL) and English support.

*Unofficial project, not affiliated with or endorsed by NIIMBOT.*

**Download:** get `NiimDesk.exe` from [Releases](../../releases/latest). It's a single file with no install, and it opens in an Edge/Chrome app window. Connect the printer with a **USB cable** (Web Serial). Bluetooth is available too, but on the D11_H it prints blank labels from a PC.

**Features:** drag-and-drop editor, text, dates, icons, shapes, tables, images, QR codes and barcodes, multiple pages, batch printing from Excel/CSV, templates, print history, and backup/restore. Everything runs offline and data stays in the browser's local storage.

### Build from source

- **Run from source:** `python serve.py` (Python 3) opens the app from the project files.
- **Build the EXE:** run `build-exe.bat`. It compiles `exe-src/Launcher.cs` with the C# compiler that ships with .NET Framework 4 (built into Windows) and embeds the web files. The output goes to `dist/NiimDesk.exe`.

The EXE is a small local web server. It listens on `localhost` only (ports 8765 to 8768), serves the embedded files, and exits about a minute after the app window is closed. It installs nothing and needs no admin rights.

### Credits

Printing uses [niimbluelib](https://github.com/MultiMote/niimbluelib) by MultiMote, the library behind [niim.blue](https://niim.blue) (MIT). NiimDesk also uses [JsBarcode](https://github.com/lindell/JsBarcode) (MIT), [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT) and [SheetJS](https://sheetjs.com) (Apache-2.0). See [licenses.txt](licenses.txt).

### License

[MIT](LICENSE)
