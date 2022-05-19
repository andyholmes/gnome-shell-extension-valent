%global tarball_version %%(echo %{version} | tr '~' '.')
%global debug_package %{nil}

%global gnome_shell_version 3.38.0
%global libpeas_version     1.22.0
%global valent_version      1.0.0.alpha

Name:           gnome-shell-extension-valent
Version:        1~alpha
Release:        1%{?dist}
Summary:        GNOME Shell integration for Valent

License:        GPLv3+
URL:            https://github.com/andyholmes/%{name}
Source0:        %{url}/archive/v%{version}/%{name}-%{tarball_version}.tar.gz

BuildArch:      noarch
BuildRequires:  gettext
BuildRequires:  meson
Requires:       gnome-shell%{?_isa} >= %{gnome_shell_version}
Requires:       libpeas-loader-python3%{?_isa} >= %{libpeas_version}
Requires:       valent%{?_isa} >= %{valent_version}


%description
Valent is an implementation of the KDE Connect protocol, built on GNOME platform
libraries.

This GNOME Shell extension helps Valent integrate with the GNOME desktop. The
bundled Python plugin is used by Valent to communicate with the extension.

%prep
%autosetup -p1 -n %{name}-%{tarball_version}

%build
%meson
%meson_build

%install
%meson_install
%find_lang %{name}

%check
%meson_test

%files -f %{name}.lang
%doc README.md
%license LICENSE
%{_datadir}/gnome-shell/extensions/valent@andyholmes.ca/
%{_libdir}/valent/plugins/

%changelog
* Wed May 18 2022 Andy Holmes <andrew.g.r.holmes@gmail.com> - 1-1
- Initial release

